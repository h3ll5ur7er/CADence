import type { Core } from '@core/composition';
import type {
  BodyProperties,
  DocumentId,
  DocumentSummary,
  Measurement,
  ProjectSummary,
  Result,
  SimulationResult,
  TopologyRef,
  ValidationReport,
  Vec2,
} from '@core/contracts';
import { sourceKey } from '@core/contracts';
import type { AssemblyCommand, AssemblyFormat, AssemblySession, AssemblyState } from '@core/managers/assembly';
import type { DesignSession, DesignState, DrawingFormat, ExportOptions, SolidFormat } from '@core/managers/design';
import type { ProjectManager } from '@core/managers/project';
import { encodePng } from '@core/utilities/picture';
import { type RasterMesh, rasterize, type RasterView, rasterViews } from '@core/utilities/raster';
import { expandShape, type ScriptCommand } from './shapes';

/** A refused command or a missing project, document or file; `code` is the core's error code. */
export class CadenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Where exported files go. */
export interface ExportTarget {
  /** Paths of the files written so far, oldest first. */
  readonly delivered: readonly string[];
  deliverNextTo(path: string): void;
}

/** A value, or the error of a result. */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new CadenceError(result.error.code, result.error.message);
  return result.value;
}

/** How a picture of a component or an assembly is taken. */
export interface PictureOptions {
  /** From where: `iso` (front, right, above; the default), `front`, `back`, `top`, `bottom`, `left` or `right`. */
  readonly view?: RasterView;
  /** Pixels; 800 × 600 by default. */
  readonly width?: number;
  readonly height?: number;
  /** A white ground instead of a transparent one. */
  readonly white?: boolean;
}

/** The meshes as a PNG, seen from the chosen view. */
async function picture(meshes: readonly RasterMesh[], options: PictureOptions): Promise<Uint8Array> {
  const view = rasterViews[options.view ?? 'iso'];
  if (!view) throw new CadenceError('usage', `No view "${options.view}".`);
  const [width, height] = [Math.round(options.width ?? 800), Math.round(options.height ?? 600)];
  if (!(width > 0 && height > 0 && width * height <= 16_000_000)) throw new CadenceError('usage', 'A picture is 1 to 16 million pixels.');
  if (!meshes.length) throw new CadenceError('nothing-to-show', 'There are no bodies to show yet.');
  const data = rasterize(meshes, { width, height, ...view, ...(options.white ? { background: [255, 255, 255, 255] as const } : {}) });
  return encodePng({ width, height, data });
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (values: readonly number[]) => values.map(round);

/** A component as plain data, for printing and for agents. */
export interface ComponentSummary {
  readonly id: string;
  readonly name: string;
  readonly units: string;
  readonly parameters: readonly { readonly name: string; readonly expression: string; readonly value?: string; readonly project?: boolean }[];
  readonly timeline: readonly { readonly id: string; readonly type: string; readonly name: string; readonly state: string; readonly error?: string }[];
  readonly sketches: readonly {
    readonly id: string;
    readonly status: string;
    readonly degreesOfFreedom: number;
    readonly error?: string;
    /** Closed regions: area (mm²), extent of the outline, and how many holes are cut out of it. */
    readonly profiles: readonly { readonly id: string; readonly area: number; readonly holes: number; readonly min: Vec2; readonly max: Vec2 }[];
  }[];
  readonly bodies: readonly {
    readonly id: string;
    readonly faces: readonly { readonly name: string; readonly planar: boolean; readonly center: readonly number[] }[];
    readonly edges: readonly string[];
  }[];
  readonly sheetMetal: boolean;
}

/** One component open for scripting: commands, exports and checks. */
export class ComponentScript {
  constructor(
    private readonly session: DesignSession,
    private readonly exports: ExportTarget,
  ) {}

  state(): DesignState {
    return this.session.state();
  }

  /** Runs the commands in order; stops at the first refusal with a CadenceError (the ones before stay). */
  async run(...commands: readonly ScriptCommand[]): Promise<void> {
    for (const command of commands) unwrap(await this.session.execute(expandShape(command)));
  }

  undo(): Promise<void> {
    return this.session.undo();
  }

  redo(): Promise<void> {
    return this.session.redo();
  }

  summary(): ComponentSummary {
    const { document, items, sketches, bodies, parameters, sheetMetal } = this.session.state();
    return {
      id: document.id,
      name: document.name,
      units: document.units,
      parameters: parameters.map(({ parameter, display, project }) => ({
        name: parameter.name,
        expression: parameter.expression,
        ...(display ? { value: display } : {}),
        ...(project ? { project } : {}),
      })),
      timeline: document.timeline.map((item) => {
        const status = items.get(item.id);
        return { id: item.id, type: item.type, name: item.name, state: status?.state ?? 'ok', ...(status?.error ? { error: status.error } : {}) };
      }),
      sketches: [...sketches.values()].map((view) => ({
        id: view.sketch.id,
        status: view.status,
        degreesOfFreedom: view.degreesOfFreedom,
        ...(view.error ? { error: view.error } : {}),
        profiles: view.profiles.map((profile) => {
          const xs = profile.outer.polygon.map((p) => p[0]);
          const ys = profile.outer.polygon.map((p) => p[1]);
          return {
            id: profile.id,
            area: round(profile.area),
            holes: profile.holes.length,
            min: roundAll([Math.min(...xs), Math.min(...ys)]) as unknown as Vec2,
            max: roundAll([Math.max(...xs), Math.max(...ys)]) as unknown as Vec2,
          };
        }),
      })),
      bodies: bodies.map((body) => ({
        id: body.body,
        faces: body.faces.map((face) => ({ name: face.name, planar: face.planar, center: roundAll(face.center) })),
        edges: body.edges.map((edge) => edge.name),
      })),
      sheetMetal,
    };
  }

  /** All bodies (or `options.bodies`) as one file; returns its path. */
  async export(format: SolidFormat, options: ExportOptions & { readonly to?: string } = {}): Promise<string> {
    const { to, ...rest } = options;
    return this.delivered(to, () => this.session.exportBodies(format, rest));
  }

  async exportSketch(sketchId: string, format: DrawingFormat, options: { readonly to?: string; readonly compensateKerf?: boolean } = {}): Promise<string> {
    const { to, ...rest } = options;
    return this.delivered(to, () => this.session.exportSketch(sketchId, format, rest));
  }

  async exportFlatPattern(format: DrawingFormat, options: { readonly to?: string } = {}): Promise<string> {
    return this.delivered(options.to, () => this.session.exportFlatPattern(format));
  }

  properties(): Promise<BodyProperties[]> {
    return this.session.properties();
  }

  validate(): Promise<ValidationReport> {
    return this.session.validate();
  }

  async measure(refs: readonly TopologyRef[]): Promise<Measurement> {
    return unwrap(await this.session.measure(refs));
  }

  /** The strength check of the stored setup (`set-simulation`): stresses in MPa, deflections in mm. */
  async simulate(): Promise<SimulationResult> {
    return unwrap(await this.session.simulate());
  }

  /** A picture of the shown bodies as a PNG (software rendering, no GPU needed). */
  picture(options: PictureOptions = {}): Promise<Uint8Array> {
    const { bodies, document } = this.session.state();
    const shown = bodies.filter((b) => !document.appearances?.[b.body]?.hidden);
    return picture(
      shown.map((b) => ({ positions: b.positions, normals: b.normals, indices: b.indices, edges: b.edgePositions, ...(document.appearances?.[b.body]?.color ? { color: document.appearances[b.body]?.color as string } : {}) })),
      options,
    );
  }

  private async delivered(to: string | undefined, write: () => Promise<Result<void>>): Promise<string> {
    if (to) this.exports.deliverNextTo(to);
    const before = this.exports.delivered.length;
    unwrap(await write());
    const path = this.exports.delivered[before];
    if (!path) throw new CadenceError('not-exported', 'Nothing was written.');
    return path;
  }
}

/** One assembly open for scripting. */
export class AssemblyScript {
  constructor(
    private readonly session: AssemblySession,
    private readonly exports: ExportTarget,
  ) {}

  state(): AssemblyState {
    return this.session.state();
  }

  async run(...commands: readonly AssemblyCommand[]): Promise<void> {
    for (const command of commands) unwrap(await this.session.execute(command));
  }

  interference() {
    return this.session.interference();
  }

  /** A picture of the shown instances as a PNG, once their components are loaded. */
  async picture(options: PictureOptions = {}): Promise<Uint8Array> {
    const loading = () => [...this.session.state().components.values()].some((c) => c.status === 'loading');
    if (loading()) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, 120_000);
        const stop = this.session.subscribe(() => (loading() ? undefined : done()));
        function done() {
          clearTimeout(timer);
          stop();
          resolve();
        }
      });
    }
    const state = this.session.state();
    const instances = [...state.document.instances, ...[...state.copies].flatMap(([id, copy]) => {
      const original = state.document.instances.find((i) => i.id === copy.instance);
      return original ? [{ ...original, id }] : [];
    })];
    const meshes = instances.flatMap((instance) => {
      const component = state.components.get(sourceKey(instance.component, instance.configuration));
      const transform = state.poses.get(instance.id);
      if (!component || !transform || instance.appearance?.hidden) return [];
      return component.bodies.flatMap((b) => {
        const look = instance.appearance?.color ?? component.appearances?.[b.body]?.color;
        return component.appearances?.[b.body]?.hidden ? [] : [{ positions: b.positions, normals: b.normals, indices: b.indices, edges: b.edgePositions, transform, ...(look ? { color: look } : {}) }];
      });
    });
    return picture(meshes, options);
  }

  async export(format: AssemblyFormat, options: { readonly to?: string } = {}): Promise<string> {
    if (options.to) this.exports.deliverNextTo(options.to);
    const before = this.exports.delivered.length;
    unwrap(await this.session.exportAssembly(format));
    return this.exports.delivered[before] as string;
  }

  close(): void {
    this.session.close();
  }
}

/**
 * The scripting API: the project manager as it is, plus components and assemblies opened for
 * scripting. Projects and documents are found by id or by name.
 */
export class Cadence {
  readonly projects: ProjectManager;
  private readonly components = new Map<string, Promise<ComponentScript>>();

  constructor(
    private readonly core: Core,
    private readonly exports: ExportTarget,
  ) {
    this.projects = core.projectManager;
  }

  async project(idOrName: string): Promise<ProjectSummary> {
    const projects = await this.projects.listProjects();
    const found = projects.find((p) => p.id === idOrName) ?? projects.find((p) => p.name === idOrName);
    if (!found) throw new CadenceError('unknown-project', `No project "${idOrName}".`);
    return found;
  }

  /** A document of a project, by id or name; without a project, a document id. */
  async document(idOrName: string, project?: string): Promise<DocumentSummary> {
    if (!project) {
      const found = await this.projects.findDocument(idOrName as DocumentId);
      if (!found) throw new CadenceError('unknown-document', `No document ${idOrName}.`);
      return found;
    }
    const documents = await this.projects.listDocuments((await this.project(project)).id);
    const found = documents.find((d) => d.id === idOrName) ?? documents.find((d) => d.name === idOrName);
    if (!found) throw new CadenceError('unknown-document', `No document "${idOrName}" in ${project}.`);
    return found;
  }

  /** A component open for scripting; opened once and kept open. */
  component(documentId: string): Promise<ComponentScript> {
    let script = this.components.get(documentId);
    if (!script) {
      script = this.core.designManager.open(documentId as DocumentId).then((session) => new ComponentScript(unwrap(session), this.exports));
      script.catch(() => this.components.delete(documentId));
      this.components.set(documentId, script);
    }
    return script;
  }

  /** A picture of a component or an assembly as a PNG. */
  async picture(documentId: string, options: PictureOptions = {}): Promise<Uint8Array> {
    const document = await this.document(documentId);
    if (document.kind === 'component') return (await this.component(document.id)).picture(options);
    if (document.kind !== 'assembly') throw new CadenceError('not-a-model', `${document.name} is not a component or an assembly.`);
    const assembly = await this.assembly(document.id);
    try {
      return await assembly.picture(options);
    } finally {
      assembly.close();
    }
  }

  async assembly(documentId: string): Promise<AssemblyScript> {
    return new AssemblyScript(unwrap(await this.core.assemblyManager.open(documentId as DocumentId)), this.exports);
  }

  /** Hands a file of an imported document over in another format; returns its path. */
  async exportImported(documentId: string, format: Parameters<ProjectManager['exportImported']>[1], options: { readonly to?: string } = {}): Promise<string> {
    if (options.to) this.exports.deliverNextTo(options.to);
    const before = this.exports.delivered.length;
    unwrap(await this.projects.exportImported(documentId as DocumentId, format));
    return this.exports.delivered[before] as string;
  }

  /** Forgets the open components (after documents changed elsewhere). */
  forget(documentId?: string): void {
    if (documentId) this.components.delete(documentId);
    else this.components.clear();
  }
}

export { unwrap };
export type { ScriptCommand };
