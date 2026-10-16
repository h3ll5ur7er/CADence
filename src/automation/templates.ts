import type { CadDocument, DocumentId, Parameter, ProjectId, ProjectTemplate } from '@core/contracts';
import type { DesignCommand } from '@core/managers/design';
import { type Cadence, type ComponentScript, unwrap } from './api';
import type { ScriptCommand } from './shapes';

/**
 * The templates new projects can start from (public/templates), made with the scripting API: each
 * builds its documents in a fresh project. `src/automation/templates.spec.ts` builds them, checks
 * that they regenerate without errors, and compares them with the files the app loads
 * (`UPDATE_TEMPLATES=1` writes them).
 */
export interface TemplateDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly Omit<Parameter, 'id'>[];
  /** Fills the project; its first component is given (the app opens it first). */
  build(cadence: Cadence, project: ProjectId, first: DocumentId): Promise<void>;
}

type Direction = 'normal' | 'reverse' | 'symmetric';
type Operation = 'new-body' | 'join' | 'cut';

/** Sketches on a plane with the given shapes, then extrudes all of the sketch's profiles. */
async function sketchAndExtrude(
  script: ComponentScript,
  id: string,
  plane: 'XY' | 'XZ' | 'YZ',
  shapes: readonly ScriptCommand[],
  extrude: { readonly id: string; readonly name: string; readonly distance: string; readonly operation: Operation; readonly direction?: Direction },
): Promise<void> {
  await script.run({ type: 'create-sketch', id, plane }, ...shapes);
  const profiles = script.summary().sketches.find((s) => s.id === id)?.profiles ?? [];
  // A ring (an outline with an opening) is one profile; the disk in its opening is left out.
  const chosen = profiles.filter((p) => !profiles.some((other) => other.holes > 0 && other !== p && inside(p, other)));
  const feature: DesignCommand = {
    type: 'add-feature',
    feature: { type: 'extrude', id: extrude.id, name: extrude.name, suppressed: false, sketch: id, profiles: chosen.map((p) => p.id), distance: extrude.distance, direction: extrude.direction ?? 'normal', operation: extrude.operation },
  };
  await script.run(feature);
}

const inside = (a: { min: readonly number[]; max: readonly number[] }, b: { min: readonly number[]; max: readonly number[] }) =>
  (a.min[0] as number) >= (b.min[0] as number) && (a.min[1] as number) >= (b.min[1] as number) && (a.max[0] as number) <= (b.max[0] as number) && (a.max[1] as number) <= (b.max[1] as number);

const shell = (id: string, body: string, thickness: string): DesignCommand => ({
  type: 'add-feature',
  feature: { type: 'shell', id, name: 'Hollow', suppressed: false, faces: [{ kind: 'face', body, name: `f:${body}:end` }], thickness },
});

/** A placement moved by (x, y, z): 4 × 4, column-major. */
const translation = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

export const templates: readonly TemplateDefinition[] = [
  {
    id: 'box-with-lid',
    name: 'Box with lid',
    description: 'A box and a lid with a rim that fits into it; size, wall and fit are parameters.',
    parameters: [
      { name: 'width', expression: '80 mm' },
      { name: 'depth', expression: '60 mm' },
      { name: 'height', expression: '40 mm' },
      { name: 'wall', expression: '2 mm' },
      { name: 'fit', expression: '0.3 mm' },
    ],
    async build(cadence, project, first) {
      unwrap(await cadence.projects.renameDocument(first, 'Box'));
      const box = await cadence.component(first);
      await sketchAndExtrude(box, 'base', 'XY', [{ type: 'add-rectangle', sketchId: 'base', id: 'outline', x: 0, y: 0, width: 'width', height: 'depth' }], {
        id: 'box',
        name: 'Box',
        distance: 'height',
        operation: 'new-body',
      });
      await box.run(shell('hollow', 'box', 'wall'));

      const lidDocument = unwrap(await cadence.projects.createDocument(project, 'component', 'Lid'));
      const lid = await cadence.component(lidDocument.id);
      await sketchAndExtrude(lid, 'top', 'XY', [{ type: 'add-rectangle', sketchId: 'top', id: 'outline', x: 0, y: 0, width: 'width', height: 'depth' }], {
        id: 'plate',
        name: 'Plate',
        distance: 'wall',
        operation: 'new-body',
      });
      await sketchAndExtrude(
        lid,
        'rim-sketch',
        'XY',
        [{ type: 'add-rectangle', sketchId: 'rim-sketch', id: 'inner', x: 2.3, y: 2.3, width: 'width - 2 * (wall + fit)', height: 'depth - 2 * (wall + fit)' }],
        { id: 'rim', name: 'Rim', distance: '4 mm', operation: 'join', direction: 'reverse' },
      );

      const assembly = unwrap(await cadence.projects.createDocument(project, 'assembly', 'Box with lid'));
      const together = await cadence.assembly(assembly.id);
      await together.run(
        { type: 'insert-instance', instance: { id: 'box', component: first, name: 'Box', transform: translation(0, 0, 0), grounded: true } },
        { type: 'insert-instance', instance: { id: 'lid', component: lidDocument.id, name: 'Lid', transform: translation(0, 0, 40), grounded: true } },
      );
      together.close();
    },
  },
  {
    id: 'wall-bracket',
    name: 'Wall bracket',
    description: 'An angle bracket with a screw hole in each leg; legs, width, thickness and screw size are parameters.',
    parameters: [
      { name: 'width', expression: '30 mm' },
      { name: 'base', expression: '40 mm' },
      { name: 'rise', expression: '50 mm' },
      { name: 'thickness', expression: '4 mm' },
      { name: 'screw', expression: '4.5 mm' },
    ],
    async build(cadence, _project, first) {
      unwrap(await cadence.projects.renameDocument(first, 'Bracket'));
      const bracket = await cadence.component(first);
      // Two legs drawn on the XZ plane, extruded across the bracket's width.
      await sketchAndExtrude(bracket, 'base-leg', 'XZ', [{ type: 'add-rectangle', sketchId: 'base-leg', id: 'leg', x: 0, y: 0, width: 'base', height: 'thickness' }], {
        id: 'bracket',
        name: 'Base leg',
        distance: 'width',
        operation: 'new-body',
        direction: 'symmetric',
      });
      await sketchAndExtrude(bracket, 'wall-leg-sketch', 'XZ', [{ type: 'add-rectangle', sketchId: 'wall-leg-sketch', id: 'leg', x: 0, y: 0, width: 'thickness', height: 'rise' }], {
        id: 'wall-leg',
        name: 'Wall leg',
        distance: 'width',
        operation: 'join',
        direction: 'symmetric',
      });
      // A hole through each leg, from sketches on the planes the legs lie on.
      await sketchAndExtrude(bracket, 'base-hole-sketch', 'XY', [{ type: 'add-circle', sketchId: 'base-hole-sketch', id: 'hole', x: 26, y: 0, diameter: 'screw' }], {
        id: 'base-hole',
        name: 'Base hole',
        distance: '20 mm',
        operation: 'cut',
        direction: 'symmetric',
      });
      await sketchAndExtrude(bracket, 'wall-hole-sketch', 'YZ', [{ type: 'add-circle', sketchId: 'wall-hole-sketch', id: 'hole', x: 0, y: 34, diameter: 'screw' }], {
        id: 'wall-hole',
        name: 'Wall hole',
        distance: '20 mm',
        operation: 'cut',
        direction: 'symmetric',
      });
    },
  },
  {
    id: 'enclosure',
    name: 'Enclosure',
    description: 'A case for a 70 × 50 mm circuit board, with screw posts at its corners; clearance, wall and height are parameters.',
    parameters: [
      { name: 'board_w', expression: '70 mm' },
      { name: 'board_d', expression: '50 mm' },
      { name: 'clearance', expression: '2 mm' },
      { name: 'wall', expression: '2 mm' },
      { name: 'height', expression: '25 mm' },
      { name: 'post', expression: '6 mm' },
    ],
    async build(cadence, _project, first) {
      unwrap(await cadence.projects.renameDocument(first, 'Case'));
      const box = await cadence.component(first);
      await sketchAndExtrude(
        box,
        'base',
        'XY',
        [{ type: 'add-rectangle', sketchId: 'base', id: 'outline', x: 0, y: 0, width: 'board_w + 2 * (clearance + wall)', height: 'board_d + 2 * (clearance + wall)' }],
        { id: 'case', name: 'Case', distance: 'height', operation: 'new-body' },
      );
      await box.run(shell('hollow', 'case', 'wall'));
      // Posts 3.5 mm in from the board's corners (the board starts at clearance + wall), with holes for M2.5 screws.
      const corners: [number, number][] = [
        [7.5, 7.5],
        [70.5, 7.5],
        [70.5, 50.5],
        [7.5, 50.5],
      ];
      await sketchAndExtrude(box, 'post-sketch', 'XY', corners.map(([x, y], i) => ({ type: 'add-circle', sketchId: 'post-sketch', id: `post${i + 1}`, x, y, diameter: 'post' }) as ScriptCommand), {
        id: 'posts',
        name: 'Posts',
        distance: '8 mm',
        operation: 'join',
      });
      await sketchAndExtrude(box, 'screws', 'XY', corners.map(([x, y], i) => ({ type: 'add-circle', sketchId: 'screws', id: `screw${i + 1}`, x, y, diameter: '2.2 mm' }) as ScriptCommand), {
        id: 'screw-holes',
        name: 'Screw holes',
        distance: '8 mm',
        operation: 'cut',
      });
    },
  },
];

/** A template from its definition, built in the given empty (in-memory) Cadence, with stable ids and times. */
export async function buildTemplate(cadence: Cadence, definition: TemplateDefinition): Promise<ProjectTemplate> {
  const parameters = definition.parameters.map((p, i): Parameter => ({ id: `p${i + 1}`, ...p }));
  const { project, firstDocument } = unwrap(await cadence.projects.createProject(definition.name));
  unwrap(await cadence.projects.setProjectParameters(project.id, parameters));
  await definition.build(cadence, project.id, firstDocument.id);
  const summaries = await cadence.projects.listDocuments(project.id);
  // The first component first: the app opens it.
  summaries.sort((a, b) => Number(b.id === firstDocument.id) - Number(a.id === firstDocument.id));
  const documents: CadDocument[] = [];
  for (const summary of summaries) {
    if (summary.kind === 'component') documents.push((await cadence.component(summary.id)).state().document);
    else if (summary.kind === 'assembly') {
      const assembly = await cadence.assembly(summary.id);
      documents.push(assembly.state().document);
      assembly.close();
    }
  }
  // Stable ids and times, so the files change only when the templates do.
  const ids = new Map(documents.map((d, i) => [d.id as string, `${definition.id}-${i + 1}`]));
  const stable = (text: string) => text.replace(/"((?:[^"\\]|\\.)*)"/g, (whole, value: string) => (ids.has(value) ? JSON.stringify(ids.get(value)) : whole));
  const time = '2026-01-01T00:00:00.000Z';
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    parameters,
    documents: documents.map((d) => JSON.parse(stable(JSON.stringify({ ...d, projectId: 'template', createdAt: time, modifiedAt: time }))) as CadDocument),
  };
}
