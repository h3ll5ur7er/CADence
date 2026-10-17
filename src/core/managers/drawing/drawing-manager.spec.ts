import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { createShapeAccess } from '@core/access/shape';
import {
  type AssemblyDocument,
  asDocumentId,
  asProjectId,
  type ComponentDocument,
  currentSchemaVersion,
  type DomainEvents,
  type DrawingDocument,
  type HoleFeature,
  originFrames,
  type Result,
  resultStamp,
} from '@core/contracts';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { decodePicture } from '@core/utilities/picture';
import { fontSource } from '@core/utilities/text';
import { beforeEach, describe, expect, it } from 'vitest';
import { holeCallout } from './callouts';
import { createDrawingManager, type DrawingSession } from './index';

const modeling = createModelingEngine(createShapeAccess());
const project = asProjectId('p1');
const stamp = '2026-10-16T10:00:00.000Z';
const header = (id: string, name: string) => ({ id: asDocumentId(id), projectId: project, name, createdAt: stamp, modifiedAt: stamp, schemaVersion: currentSchemaVersion });

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A 60 × 30 × 10 plate with a ⌀10 hole at (20, 15). */
async function plate() {
  const outcome = await modeling.apply({
    type: 'extrude',
    feature: 'e1',
    key: 'drawing-manager-plate',
    bodies: [],
    frame: originFrames.XY,
    profiles: [profile(rectangleLoop(0, 0, 60, 30, 'plate'), [circleLoop(20, 15, 5, 'hole', false)])],
    distance: 10,
    direction: 'normal',
    operation: 'new-body',
  });
  return outcome.bodies;
}

describe('DrawingManager', () => {
  let documents: InMemoryDocumentAccess;
  let assets: InMemoryAssetAccess;
  let files: InMemoryExternalFileAccess;
  let events: EventBus<DomainEvents>;
  let session: DrawingSession;

  beforeEach(async () => {
    documents = new InMemoryDocumentAccess();
    assets = new InMemoryAssetAccess();
    files = new InMemoryExternalFileAccess();
    events = new EventBus<DomainEvents>();
    const bodies = await plate();
    await documents.store({ ...header('plate', 'Plate'), kind: 'component', units: 'mm', parameters: [], timeline: [], rollbackIndex: 0 } satisfies ComponentDocument);
    await assets.publishResult({ documentId: asDocumentId('plate'), projectId: project, stamp: resultStamp(stamp, []), bytes: await modeling.snapshot(bodies) });
    // An assembly of two plates, as its editor would publish it: placed side by side.
    const body = bodies[0] as NonNullable<(typeof bodies)[number]>;
    const placed = await modeling.snapshotPlaced([
      { id: 'i1', body, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { id: 'i2', body, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1] },
    ]);
    const instance = (id: string) => ({ id, component: asDocumentId('plate'), name: id, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], grounded: false });
    await documents.store({ ...header('stack', 'Stack'), kind: 'assembly', instances: [instance('i1'), instance('i2')], joints: [], motionStudies: [] } satisfies AssemblyDocument);
    await assets.publishResult({ documentId: asDocumentId('stack'), projectId: project, stamp, bytes: placed });
    await documents.store({
      ...header('sheet', 'Plate drawing'),
      kind: 'drawing',
      sheet: { size: 'A3', orientation: 'landscape', scale: 2 },
      titleBlock: { title: '', number: 'D-1', drawnBy: 'EK', material: 'PLA', revision: 'A' },
      views: [],
      annotations: [],
    } satisfies DrawingDocument);
    const manager = createDrawingManager({
      projects: new InMemoryProjectAccess(),
      documents,
      assets,
      externalFiles: files,
      modeling,
      parameters: createParameterEngine(),
      events,
      clock: steppingClock('2026-10-16T11:00:00.000Z'),
      fonts: fontSource(),
    });
    session = unwrap(await manager.open(asDocumentId('sheet')));
  });

  const view = (id: string, direction: 'front' | 'top', at: [number, number], extra = {}) => ({ id, source: asDocumentId('plate'), direction, at, hidden: true, ...extra });
  const texts = () => session.state().layout.texts.map((t) => t.text);

  it('draws views of a component at the sheet scale, with a frame and title block', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    unwrap(await session.execute({ type: 'add-view', view: view('front', 'front', [120, 90]) }));
    const { layout } = session.state();
    expect([layout.width, layout.height]).toEqual([420, 297]);
    // 60 × 30 at 2:1 is 120 × 60 on the sheet, centred where the view is.
    const top = layout.views.find((v) => v.id === 'top');
    expect(top?.min.map((v) => Math.round(v))).toEqual([60, 170]);
    expect(top?.max.map((v) => Math.round(v))).toEqual([180, 230]);
    expect(layout.paths.some((p) => p.owner === 'front' && p.style === 'hidden')).toBe(true);
    expect(texts()).toEqual(expect.arrayContaining(['Plate drawing', 'D-1', '2:1', 'PLA']));
    expect(layout.anchors.filter((a) => a.view === 'top' && a.kind === 'circle').some((a) => Math.abs((a.radius ?? 0) - 10) < 1e-6)).toBe(true);
  });

  it('dimensions views from model geometry, and calls out holes', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    const anchors = session.state().layout.anchors.filter((a) => a.view === 'top');
    const corners = anchors.filter((a) => a.kind === 'point').sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
    const [left, right] = [corners[0], corners.at(-1)] as [NonNullable<(typeof corners)[number]>, NonNullable<(typeof corners)[number]>];
    const circle = anchors.find((a) => a.kind === 'circle') as NonNullable<(typeof anchors)[number]>;
    const ref = (a: typeof left) => ({ view: a.view, kind: a.kind, name: a.name });
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'w', type: 'horizontal', anchors: [ref(left), ref(right)], offset: 10 } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'r', type: 'diameter', anchors: [ref(circle)], offset: 8 } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'callout', id: 'c', circle: ref(circle), at: [200, 260] } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'center-mark', id: 'm', circle: ref(circle) } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'note', id: 'n', at: [30, 40], text: 'Break all edges\n0.5 × 45°' } }));
    // In model millimetres, though drawn at 2:1.
    expect(texts()).toEqual(expect.arrayContaining(['60', '⌀10', 'Break all edges']));
    expect(session.state().layout.arrows.filter((a) => a.owner === 'w')).toHaveLength(2);
    expect(session.state().layout.lost).toEqual([]);
    expect(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'x', type: 'radius', anchors: [ref(left)], offset: 5 } })).toMatchObject({ ok: false });

    unwrap(await session.exportPdf());
    expect(files.delivered.at(-1)?.name).toBe('Plate drawing.pdf');
    expect(Array.from(files.delivered.at(-1)?.bytes ?? [], (c) => String.fromCharCode(c)).join('').startsWith('%PDF-1.4')).toBe(true);
    unwrap(await session.exportDxf());
    const dxf = new TextDecoder().decode(files.delivered.at(-1)?.bytes);
    expect(dxf).toContain('VISIBLE');
    expect(dxf).toContain('\nTEXT\n');

    // Removing the view takes what is attached to it.
    unwrap(await session.execute({ type: 'remove-view', viewId: 'top' }));
    expect(session.state().document.annotations.map((a) => a.id)).toEqual(['n']);
    await session.undo();
    expect(session.state().document.annotations).toHaveLength(5);
  });

  it('pictures the sheet, or one view of it, as the PDF shows it (CAD-123)', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    const dark = async (png: Uint8Array) => {
      const picture = await decodePicture(png);
      let count = 0;
      for (let i = 0; i < picture.width * picture.height; i++) if ((picture.data[i * 4] as number) < 128) count++;
      return { width: picture.width, height: picture.height, share: count / (picture.width * picture.height) };
    };
    // A3 landscape, 840 pixels wide: 2 pixels a millimetre.
    const sheet = await dark(unwrap(await session.picture({ width: 840 })));
    expect([sheet.width, sheet.height]).toEqual([840, 594]);
    expect(sheet.share).toBeGreaterThan(0.005);
    // The view zoomed: its 120 × 60 mm box with 15 mm around it.
    const top = await dark(unwrap(await session.picture({ width: 600, view: 'top' })));
    expect([top.width, top.height]).toEqual([600, 360]);
    expect(top.share).toBeGreaterThan(0.005);
    expect(await session.picture({ view: 'nope' })).toMatchObject({ ok: false, error: { message: 'There is no view "nope".' } });
  });

  it('draws sections, details and assemblies with their parts list and balloons', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('front', 'front', [120, 90], { section: { offset: 0 }, label: 'Section A-A' }) }));
    expect(session.state().layout.paths.some((p) => p.owner === 'front' && p.style === 'hatch')).toBe(true);
    unwrap(await session.execute({ type: 'add-view', view: { ...view('detail', 'front', [300, 90]), detail: { of: 'front', center: [20, 5], radius: 8 }, scale: 5, label: 'Detail B' } }));
    expect(session.state().layout.paths.filter((p) => p.owner === 'detail').length).toBeGreaterThan(3);
    expect(texts()).toEqual(expect.arrayContaining(['Section A-A', 'Detail B', 'B']));

    unwrap(await session.execute({ type: 'add-view', view: { id: 'iso', source: asDocumentId('stack'), direction: 'iso', at: [300, 220], hidden: false } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'parts-list', id: 'parts', view: 'iso', at: [400, 280] } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'balloon', id: 'b1', view: 'iso', instance: 'i2', at: [360, 250] } }));
    expect(texts()).toEqual(expect.arrayContaining(['Item', 'Plate', '2', 'PLA']));
    expect(session.state().layout.texts.filter((t) => t.owner === 'b1').map((t) => t.text)).toEqual(['1']);
    expect(session.state().layout.lost).toEqual([]);
  });

  it('says what a hole is from its feature', () => {
    const hole: HoleFeature = { id: 'h1', type: 'hole', name: 'Hole 1', suppressed: false, sketch: 's', points: ['a', 'b'], kind: 'counterbore', diameter: 'd', extent: 'blind', depth: '12 mm', boreDiameter: '9 mm', boreDepth: '3', sinkDiameter: '0', sinkAngle: '90 deg', teardrop: false, bridge: false };
    const document: ComponentDocument = { ...header('c', 'C'), kind: 'component', units: 'mm', parameters: [{ id: 'p', name: 'd', expression: '5 mm' }], timeline: [hole], rollbackIndex: 0 };
    expect(holeCallout(document, [], 'e:f:h1:wall:a|f:e1:end', 2.5, createParameterEngine())).toEqual(['2 × ⌀5 depth 12', 'counterbore ⌀9 depth 3']);
    expect(holeCallout(document, [], 'e:f:e1:side:hole', 4, createParameterEngine())).toEqual(['⌀8']);
  });
});
