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
  type ThreadFeature,
  type Tolerance,
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
  /** A Drawing Manager over this test's documents, with other dependencies swapped in. */
  let managerWith: (deps?: Partial<Parameters<typeof createDrawingManager>[0]>) => ReturnType<typeof createDrawingManager>;

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
    managerWith = (deps = {}) =>
      createDrawingManager({
        projects: new InMemoryProjectAccess(),
        documents,
        assets,
        externalFiles: files,
        modeling,
        parameters: createParameterEngine(),
        events,
        clock: steppingClock('2026-10-16T11:00:00.000Z'),
        fonts: fontSource(),
        ...deps,
      });
    session = unwrap(await managerWith().open(asDocumentId('sheet')));
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

  it('shows a configuration of a component (CAD-126)', async () => {
    // A thin configuration of the plate, 4 mm instead of 10, with its own result.
    const thin = await modeling.apply({ type: 'extrude', feature: 'e1', key: 'drawing-manager-thin', bodies: [], frame: originFrames.XY, profiles: [profile(rectangleLoop(0, 0, 60, 30, 'plate'))], distance: 4, direction: 'normal', operation: 'new-body' });
    const plateDocument = (await documents.load(asDocumentId('plate'))) as ComponentDocument;
    await documents.store({ ...plateDocument, configurations: [{ id: 'thin', name: 'Thin', values: {} }] });
    await assets.publishResult({ documentId: asDocumentId('plate'), projectId: project, configuration: 'thin', stamp: resultStamp(stamp, []), bytes: await modeling.snapshot(thin.bodies) });
    unwrap(await session.execute({ type: 'add-view', view: view('whole', 'front', [120, 200]) }));
    unwrap(await session.execute({ type: 'add-view', view: view('thin', 'front', [120, 90], { configuration: 'thin' }) }));
    const height = (id: string) => {
      const placed = session.state().layout.views.find((v) => v.id === id);
      return Math.round(((placed?.max[1] ?? 0) - (placed?.min[1] ?? 0)) / 2);
    };
    expect([height('whole'), height('thin')]).toEqual([10, 4]);
    expect(await session.execute({ type: 'add-view', view: view('x', 'top', [300, 90], { configuration: 'nope' }) })).toMatchObject({ ok: false, error: { message: 'Plate has no configuration nope; its configurations are thin (Thin).' } });
  });

  it('draws a view from the triangles when the exact projection takes too long, and keeps drawn views with the drawing (CAD-125)', async () => {
    // A views kernel that runs out of time on every view.
    const late = { restore: modeling.restore.bind(modeling), drawView: () => Promise.reject(Object.assign(new Error('Too long.'), { name: 'TimeoutError' })) };
    const slow = unwrap(await managerWith({ views: late }).open(asDocumentId('sheet')));
    const seen: string[] = [];
    slow.subscribe((state) => seen.push(state.layout.views.find((v) => v.id === 'top')?.error ?? 'drawn'));
    unwrap(await slow.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    // The sheet is laid out with the view still being drawn, then again once it is.
    expect(seen).toEqual(['Drawing…', 'drawn']);
    const top = slow.state().layout.views.find((v) => v.id === 'top');
    expect(top?.note).toBe('Drawn from the triangles: the exact projection took too long.');
    expect(top?.min.map(Math.round)).toEqual([60, 170]);
    // A handful of paths, as drawn exactly: the outline and the hole (CAD-130).
    expect(slow.state().layout.paths.filter((p) => p.owner === 'top').length).toBeLessThan(10);
    slow.close();

    // Another process opens the drawing: the drawn view comes from the drawing's result, not drawn again.
    let drawn = 0;
    const counting: typeof modeling = Object.assign(Object.create(modeling) as typeof modeling, { drawView: (...args: Parameters<typeof modeling.drawView>) => (drawn++, modeling.drawView(...args)) });
    const again = unwrap(await managerWith({ modeling: counting }).open(asDocumentId('sheet')));
    expect(drawn).toBe(0);
    expect(again.state().layout.views.find((v) => v.id === 'top')?.note).toBe('Drawn from the triangles: the exact projection took too long.');
  });

  it('marks where a section cuts, and fills in the material (CAD-127)', async () => {
    unwrap(await session.execute({ type: 'set-title-block', titleBlock: { ...session.state().document.titleBlock, material: '' } }));
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    unwrap(await session.execute({ type: 'add-view', view: view('cut', 'front', [120, 90], { section: { offset: 0 }, label: 'Section A-A' }) }));
    const { layout } = session.state();
    // The cutting plane (y = 15, the plate's middle) runs across the top view, with the letter at each end.
    const chain = layout.paths.find((p) => p.owner === 'cut' && p.style === 'center');
    expect(chain?.points.map((p) => Math.round(p[1]))).toEqual([200, 200]);
    expect(Math.min(...(chain?.points.map((p) => p[0]) ?? []))).toBeLessThan(60);
    expect(layout.texts.filter((t) => t.owner === 'cut' && t.text === 'A')).toHaveLength(2);
    expect(layout.arrows.filter((a) => a.owner === 'cut').every((a) => Math.round(a.direction[1]) === 1)).toBe(true);
    expect(session.state().material).toBe('PLA');
    expect(texts()).toContain('PLA');
  });

  it('dimensions from circle centres, across cylinder outlines and at an angle (CAD-127)', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    unwrap(await session.execute({ type: 'add-view', view: { ...view('side', 'top', [300, 90]), direction: 'right' } }));
    const anchors = session.state().layout.anchors;
    const ref = (a: (typeof anchors)[number]) => ({ view: a.view, kind: a.kind, name: a.name });
    const hole = anchors.find((a) => a.view === 'top' && a.kind === 'circle') as (typeof anchors)[number];
    const left = anchors.filter((a) => a.view === 'top' && a.kind === 'point').sort((a, b) => a.at[0] - b.at[0])[0] as (typeof anchors)[number];
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'x', type: 'horizontal', anchors: [ref(left), ref(hole)], offset: 10 } }));
    expect(session.state().layout.texts.filter((t) => t.owner === 'x').map((t) => t.text)).toEqual(['20']);
    // From the right, the hole's wall shows two outlines inside the plate: hidden, 10 apart.
    const outlines = anchors.filter((a) => a.view === 'side' && a.kind === 'line' && a.name.startsWith('s:'));
    expect(outlines).toHaveLength(2);
    expect(outlines.every((a) => a.hidden)).toBe(true);
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'd', type: 'diameter', anchors: outlines.map(ref), offset: 6 } }));
    expect(session.state().layout.texts.filter((t) => t.owner === 'd').map((t) => t.text)).toEqual(['⌀10']);
    // A diameter leaving its circle up and to the left: its text ends at the leader.
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'a', type: 'diameter', anchors: [ref(hole)], offset: 8, angle: 135 } }));
    expect(session.state().layout.texts.find((t) => t.owner === 'a')).toMatchObject({ align: 'right' });
    expect(session.state().layout.texts.find((t) => t.owner === 'a')?.at[0]).toBeLessThan(hole.at[0]);
  });

  it('says what a hole is from its feature', () => {
    const hole: HoleFeature = { id: 'h1', type: 'hole', name: 'Hole 1', suppressed: false, sketch: 's', points: ['a', 'b'], kind: 'counterbore', diameter: 'd', extent: 'blind', depth: '12 mm', boreDiameter: '9 mm', boreDepth: '3', sinkDiameter: '0', sinkAngle: '90 deg', teardrop: false, bridge: false };
    const document: ComponentDocument = { ...header('c', 'C'), kind: 'component', units: 'mm', parameters: [{ id: 'p', name: 'd', expression: '5 mm' }], timeline: [hole], rollbackIndex: 0 };
    expect(holeCallout(document, [], 'e:f:h1:wall:a|f:e1:end', 2.5, createParameterEngine())).toEqual(['2 × ⌀5 depth 12', 'counterbore ⌀9 depth 3']);
    expect(holeCallout(document, [], 'e:f:e1:side:hole', 4, createParameterEngine())).toEqual(['⌀8']);
  });
  it('steps the cutting line of an offset section, and marks a half section by its centre line (CAD-164)', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    // 5 mm towards the viewer (y = 10) left of x = 25, through the hole's middle (y = 15) from there on.
    unwrap(await session.execute({ type: 'add-view', view: view('cut', 'front', [120, 90], { section: { offset: 5, steps: [{ at: -5, offset: 0 }] }, label: 'Section A-A' }) }));
    const chain = session.state().layout.paths.find((p) => p.owner === 'cut' && p.style === 'center');
    // On the top view at 2:1: y = 10 is 190 on the sheet, y = 15 is 200, the step at x = 25 is 110.
    expect(chain?.points.map((p) => Math.round(p[1]))).toEqual([190, 190, 200, 200]);
    expect(chain?.points.slice(1, 3).map((p) => Math.round(p[0]))).toEqual([110, 110]);
    // Thick where it turns, and at its ends.
    expect(session.state().layout.paths.filter((p) => p.owner === 'cut' && p.style === 'visible').length).toBeGreaterThanOrEqual(4);
    expect(session.state().layout.paths.some((p) => p.owner === 'cut' && p.style === 'hatch')).toBe(true);

    unwrap(await session.execute({ type: 'add-view', view: view('half', 'front', [300, 90], { section: { offset: 0, half: true }, label: 'Section B-B' }) }));
    const centre = session.state().layout.paths.filter((p) => p.owner === 'half' && p.style === 'center');
    // Its centre line, through the plate's middle, and its cutting line on the top view from the middle out.
    expect(centre.some((p) => p.points.every((q) => Math.round(q[0]) === 300))).toBe(true);
    const cutting = centre.find((p) => p.points.every((q) => Math.round(q[1]) === 200));
    expect(Math.round(cutting?.points[0]?.[0] ?? 0)).toBe(120);
    expect(session.state().layout.texts.filter((t) => t.owner === 'half' && t.text === 'B')).toHaveLength(1);
    expect(await session.execute({ type: 'edit-view', view: view('half', 'front', [300, 90], { section: { offset: Number.NaN } }) })).toMatchObject({ ok: false });
  });

  it('writes tolerances and fits after dimensions, and surface finish symbols on edges (CAD-165)', async () => {
    unwrap(await session.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    const anchors = session.state().layout.anchors.filter((a) => a.view === 'top');
    const ref = (a: (typeof anchors)[number]) => ({ view: a.view, kind: a.kind, name: a.name });
    const hole = anchors.find((a) => a.kind === 'circle') as (typeof anchors)[number];
    const tolerances: Record<string, Tolerance> = {
      fit: { kind: 'fit', fit: 'H7' },
      values: { kind: 'fit', fit: 'H7', deviations: true },
      plusMinus: { kind: 'symmetric', value: 0.1 },
      deviations: { kind: 'deviations', upper: 0.1, lower: -0.05 },
      limits: { kind: 'limits', upper: 0.015, lower: 0 },
    };
    for (const [id, tolerance] of Object.entries(tolerances)) unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id, type: 'diameter', anchors: [ref(hole)], offset: 8, tolerance } }));
    const of = (id: string) => session.state().layout.texts.filter((t) => t.owner === id).map((t) => t.text);
    expect(of('fit')).toEqual(['⌀10 H7']);
    expect(of('values')).toEqual(['⌀10 H7 (+0.015/0)']);
    expect(of('plusMinus')).toEqual(['⌀10 ±0.1']);
    expect(of('deviations')).toEqual(['⌀10', '+0.1', '-0.05']);
    expect(of('limits')).toEqual(['⌀10.015', '⌀10']);
    const refused = await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'bad', type: 'diameter', anchors: [ref(hole)], offset: 8, tolerance: { kind: 'fit', fit: 's6' } } });
    expect(refused).toMatchObject({ ok: false, error: { message: 'Shafts d to p and js are known; not s6.' } });

    // On the plate's top edge (y = 30: 230 on the sheet), standing above it.
    const edge = anchors.find((a) => a.kind === 'line' && !a.hidden && Math.round(a.start?.[1] ?? 0) === 230 && Math.round(a.end?.[1] ?? 0) === 230) as (typeof anchors)[number];
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'surface-finish', id: 'sf', at: [100, 240], edge: ref(edge), process: 'removal', roughness: 'Ra 3.2', method: 'milled' } }));
    expect(of('sf')).toEqual(['Ra 3.2', 'milled']);
    const tick = session.state().layout.paths.filter((p) => p.owner === 'sf');
    // The symbol's tip on the edge, its legs and bar above it.
    expect(tick[0]?.points.map((p) => p.map((x) => Math.round(x * 10) / 10))).toContainEqual([100, 230]);
    expect(tick.flatMap((p) => p.points).every((p) => p[1] >= 230 - 1e-6)).toBe(true);
    expect(tick).toHaveLength(2);
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'surface-finish', id: 'free', at: [300, 250], leader: [280, 230], process: 'no-removal' } }));
    expect(session.state().layout.arrows.filter((a) => a.owner === 'free')).toHaveLength(1);
    expect(session.state().layout.lost).toEqual([]);
  });

  it('measures lengths on isometric views in the model, along its axes too (CAD-165)', async () => {
    unwrap(await session.execute({ type: 'add-view', view: { ...view('iso', 'top', [200, 150]), direction: 'iso', hidden: false } }));
    const points = session.state().layout.anchors.filter((a) => a.view === 'iso' && a.kind === 'point' && a.model);
    const at = (x: number, y: number, z: number) => points.find((p) => Math.hypot((p.model?.[0] ?? 0) - x, (p.model?.[1] ?? 0) - y, (p.model?.[2] ?? 0) - z) < 1e-6) as (typeof points)[number];
    const ref = (a: (typeof points)[number]) => ({ view: a.view, kind: a.kind, name: a.name });
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'long', type: 'linear', anchors: [ref(at(0, 0, 10)), ref(at(60, 0, 10))], offset: 10 } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'deep', type: 'linear', anchors: [ref(at(0, 0, 10)), ref(at(60, 30, 10))], offset: 10, axis: 'y' } }));
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'high', type: 'linear', anchors: [ref(at(60, 0, 0)), ref(at(60, 0, 10))], offset: 10, axis: 'z' } }));
    const of = (id: string) => session.state().layout.texts.filter((t) => t.owner === id).map((t) => t.text);
    // 60 on the sheet would be 60 × √(2/3) × 2.
    expect([of('long'), of('deep'), of('high')]).toEqual([['60'], ['30'], ['10']]);
    // The line along y as the view shows it: up and to the left.
    const line = session.state().layout.paths.filter((p) => p.owner === 'deep').find((p) => p.points.length === 2 && Math.abs((p.points[1]?.[0] ?? 0) - (p.points[0]?.[0] ?? 0)) > 20) ?? session.state().layout.paths.filter((p) => p.owner === 'deep')[2];
    const [a, b] = line?.points ?? [];
    const slope = ((b?.[1] ?? 0) - (a?.[1] ?? 0)) / ((b?.[0] ?? 0) - (a?.[0] ?? 1));
    expect(slope).toBeCloseTo(-Math.tan(Math.PI / 6), 6);
    expect(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'x', type: 'angle', anchors: [], offset: 10, axis: 'x' } })).toMatchObject({ ok: false });
  });

  it('dimensions each part of an assembly view by its instance (CAD-167)', async () => {
    unwrap(await session.execute({ type: 'add-view', view: { id: 'stack', source: asDocumentId('stack'), direction: 'top', at: [200, 150], hidden: false } }));
    const anchors = session.state().layout.anchors.filter((a) => a.view === 'stack');
    expect(anchors.some((a) => a.name.startsWith('i1/')) && anchors.some((a) => a.name.startsWith('i2/'))).toBe(true);
    // The upper plate's hole: the lower one is hidden under it.
    const hole = anchors.find((a) => a.kind === 'circle' && a.name.startsWith('i2/') && !a.hidden) as (typeof anchors)[number];
    unwrap(await session.execute({ type: 'add-annotation', annotation: { kind: 'dimension', id: 'd', type: 'diameter', anchors: [{ view: 'stack', kind: 'circle', name: hole.name }], offset: 8 } }));
    expect(session.state().layout.texts.filter((t) => t.owner === 'd').map((t) => t.text)).toEqual(['⌀10']);
  });

  it('draws a view that took too long exactly in the background, and shows it when done (CAD-168)', async () => {
    const late = { restore: modeling.restore.bind(modeling), drawView: () => Promise.reject(Object.assign(new Error('Too long.'), { name: 'TimeoutError' })) };
    let exactly = 0;
    const exact = { restore: modeling.restore.bind(modeling), drawView: (...args: Parameters<typeof modeling.drawView>) => (exactly++, modeling.drawView(...args)) };
    const slow = unwrap(await managerWith({ views: late, exact }).open(asDocumentId('sheet')));
    const note = () => slow.state().layout.views.find((v) => v.id === 'top')?.note;
    const finished = new Promise<void>((done) => slow.subscribe((state) => state.layout.views.some((v) => v.id === 'top' && !v.error && !v.note) && done()));
    unwrap(await slow.execute({ type: 'add-view', view: view('top', 'top', [120, 200]) }));
    expect(note()).toBe('Drawn from the triangles for now: the exact projection takes long and is still being drawn.');
    await finished;
    expect(note()).toBeUndefined();
    expect(exactly).toBe(1);
    // Kept with the drawing: another process opens it exact.
    slow.close();
    const again = unwrap(await managerWith({ views: late, exact }).open(asDocumentId('sheet')));
    expect(again.state().layout.views.find((v) => v.id === 'top')?.note).toBeUndefined();
    expect(exactly).toBe(1);
  });

  it('calls out threads from their feature (CAD-166)', () => {
    const shaft: ThreadFeature = { id: 't', type: 'thread', name: 'Thread', suppressed: false, face: { kind: 'face', body: 'b', name: 'f:shank:side:shank' }, size: 'M10', length: '8 mm', modelled: true, flip: false };
    const hole: HoleFeature = { id: 'h1', type: 'hole', name: 'Hole', suppressed: false, sketch: 's', points: ['a', 'b'], kind: 'simple', diameter: '5 mm', extent: 'through', depth: '0', boreDiameter: '0', boreDepth: '0', sinkDiameter: '0', sinkAngle: '90 deg', teardrop: false, bridge: false };
    const tapped: ThreadFeature = { ...shaft, id: 't2', face: { kind: 'face', body: 'b', name: 'f:h1:wall:a' }, size: 'M6', length: '' };
    const document: ComponentDocument = { ...header('c', 'C'), kind: 'component', units: 'mm', parameters: [], timeline: [hole, shaft, tapped], rollbackIndex: 0 };
    expect(holeCallout(document, [], 'thread:t', 5, createParameterEngine())).toEqual(['M10 thread', 'length 8']);
    expect(holeCallout(document, [], 'i1/thread:t', 5, createParameterEngine())).toEqual(['M10 thread', 'length 8']);
    expect(holeCallout(document, [], 'thread:t2', 3, createParameterEngine())).toEqual(['2 × M6 thread', '2 × ⌀5 thru']);
  });
});
