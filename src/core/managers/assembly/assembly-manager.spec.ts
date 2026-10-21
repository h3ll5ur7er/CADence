import { readFileSync } from 'node:fs';
import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryProjectAccess } from '@core/access/project';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { createShapeAccess } from '@core/access/shape';
import {
  type AssemblyDocument,
  asAssetId,
  asDocumentId,
  asProjectId,
  type ComponentDocument,
  currentSchemaVersion,
  type DocumentId,
  type DomainEvents,
  type Joint,
  type Matrix4,
  offsetFrame,
  sourceKey,
  originFrames,
  type Result,
} from '@core/contracts';
import { cubeStl } from '@core/contracts/testing/files';
import { circleLoop, profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createKinematicsEngine } from '@core/engines/kinematics';
import { createModelingEngine } from '@core/engines/modeling';
import { steppingClock } from '@core/utilities/clock';
import { identity, transformPoint, translation } from '@core/utilities/math';
import { EventBus } from '@core/utilities/messaging';
import { beforeEach, describe, expect, it } from 'vitest';
import { readZip } from '@core/utilities/archive';
import { type AssemblySession, createAssemblyManager } from './index';

const shapes = createShapeAccess();
const modeling = createModelingEngine(shapes);
const project = asProjectId('p1');
const stamp = '2026-10-14T10:00:00.000Z';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const component = (id: string, name: string): ComponentDocument => ({
  id: asDocumentId(id),
  projectId: project,
  kind: 'component',
  name,
  createdAt: stamp,
  modifiedAt: stamp,
  schemaVersion: currentSchemaVersion,
  units: 'mm',
  parameters: [],
  timeline: [],
  rollbackIndex: 0,
});

/** A plate with a ⌀6 hole, as the Design Manager would publish it. */
async function snapshotOfPlate(feature: string, width: number, depth: number, hole: [number, number]): Promise<Uint8Array> {
  const outcome = await modeling.apply({
    type: 'extrude',
    feature,
    key: `assembly-${feature}-${width}`,
    bodies: [],
    frame: originFrames.XY,
    profiles: [profile(rectangleLoop(0, 0, width, depth, feature), [circleLoop(hole[0], hole[1], 3, `${feature}-hole`, false)])],
    distance: 5,
    direction: 'normal',
    operation: 'new-body',
  });
  return modeling.snapshot(outcome.bodies);
}

const holeOf = (feature: string) => ({ kind: 'face' as const, body: feature, name: `f:${feature}:side:${feature}-hole` });

describe('AssemblyManager', () => {
  let documents: InMemoryDocumentAccess;
  let assets: InMemoryAssetAccess;
  let files: InMemoryExternalFileAccess;
  let events: EventBus<DomainEvents>;
  let session: AssemblySession;
  const base = asDocumentId('base');
  const link = asDocumentId('link');

  /** Waits until the session reaches a state the test expects. */
  const until = (test: () => boolean) =>
    new Promise<void>((resolve) => {
      if (test()) return resolve();
      const stop = session.subscribe(() => {
        if (test()) {
          stop();
          resolve();
        }
      });
    });

  beforeEach(async () => {
    documents = new InMemoryDocumentAccess();
    assets = new InMemoryAssetAccess();
    files = new InMemoryExternalFileAccess();
    events = new EventBus<DomainEvents>();
    await documents.store(component('base', 'Base'));
    await documents.store({ ...component('link', 'Link'), configurations: [{ id: 'long', name: 'Long', values: {} }] });
    await documents.store({
      id: asDocumentId('asm'),
      projectId: project,
      kind: 'assembly',
      name: 'Arm',
      createdAt: stamp,
      modifiedAt: stamp,
      schemaVersion: currentSchemaVersion,
      instances: [],
      joints: [],
      motionStudies: [],
    } satisfies AssemblyDocument);
    // Base has a published result; Link must be requested from the "Design Manager", played here.
    await assets.publishResult({ documentId: base, projectId: project, stamp, bytes: await snapshotOfPlate('base', 60, 20, [10, 10]) });
    events.subscribe('regenerateComponent', async ({ documentId, configuration }) => {
      // The link's "Long" configuration is twice as long.
      const bytes = await snapshotOfPlate('link', configuration ? 80 : 40, 10, [5, 5]);
      if (documentId === link) await assets.publishResult({ documentId, projectId: project, stamp, bytes, ...(configuration ? { configuration } : {}) });
      events.publish('componentRegenerated', { documentId, ...(configuration ? { configuration } : {}), ok: documentId === link });
    });
    const manager = createAssemblyManager({
      projects: new InMemoryProjectAccess(),
      documents,
      assets,
      externalFiles: files,
      modeling,
      kinematics: createKinematicsEngine(),
      analysis: createAnalysisEngine(shapes),
      interchange: createInterchangeEngine(shapes),
      events,
      clock: steppingClock('2026-10-14T11:00:00.000Z'),
    });
    session = unwrap(await manager.open(asDocumentId('asm')));
  });

  const insert = (id: string, of: DocumentId, transform: Matrix4 = identity(), grounded = false) =>
    session.execute({ type: 'insert-instance', instance: { id, component: of, name: '', transform, grounded } });

  const hinge = (values: number[] = [0], extra: Partial<Joint> = {}): Joint => ({
    id: 'hinge',
    name: '',
    type: 'revolute',
    a: { instance: 'b1', ref: holeOf('base') },
    b: { instance: 'l1', ref: holeOf('link') },
    flip: false,
    values,
    limits: [null],
    ...extra,
  });

  /** Inserts a grounded base and a link, waits for the link's result, and hinges them at the holes. */
  async function arm(values = [90]): Promise<void> {
    unwrap(await insert('b1', base, identity(), true));
    unwrap(await insert('l1', link, translation([0, 50, 0])));
    await until(() => session.state().components.get(link)?.status === 'ready');
    unwrap(await session.execute({ type: 'add-joint', joint: hinge(values) }));
  }

  const where = (instance: string, local: [number, number, number]) =>
    transformPoint(session.state().poses.get(instance) as Matrix4, local).map((v) => Math.round(v * 1e6) / 1e6 + 0);

  it('inserts instances from published results and requests stale ones from the Design Manager', async () => {
    unwrap(await insert('b1', base, identity(), true));
    expect(session.state().components.get(base)).toMatchObject({ name: 'Base', status: 'ready' });
    expect(session.state().components.get(base)?.bodies[0]?.faces.length).toBe(8); // the hole is two half cylinders
    unwrap(await insert('l1', link));
    expect(session.state().components.get(link)?.status).toBe('loading');
    await until(() => session.state().components.get(link)?.status === 'ready');
    expect(session.state().document.instances.map((i) => i.name)).toEqual(['Base 1', 'Link 1']);
    expect((await documents.load(asDocumentId('asm')))?.kind).toBe('assembly');
  });

  it('shows a configuration of a component, requested from the Design Manager', async () => {
    unwrap(await insert('l1', link));
    await until(() => session.state().components.get(link)?.status === 'ready');
    unwrap(await session.execute({ type: 'set-instance-configuration', instanceId: 'l1', configuration: 'long' }));
    await until(() => session.state().components.get(sourceKey(link, 'long'))?.status === 'ready');
    expect(session.state().components.get(sourceKey(link, 'long'))).toMatchObject({ name: 'Link (Long)', configuration: 'long' });
    const width = (key: string) => {
      const positions = session.state().components.get(key)?.bodies[0]?.positions ?? [];
      const xs = Array.from(positions).filter((_, i) => i % 3 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(sourceKey(link, 'long'))).toBeCloseTo(80);
    // The parameters' own values are shown by no instance now: let go (CAD-135).
    expect(session.state().components.has(link)).toBe(false);
  });

  it('keeps how instances look: hidden, colour and transparency', async () => {
    unwrap(await insert('b1', base, identity(), true));
    unwrap(await session.execute({ type: 'set-instance-appearance', instanceId: 'b1', appearance: { hidden: true, color: '#1971c2', opacity: 0.4 } }));
    expect(session.state().document.instances[0]?.appearance).toEqual({ hidden: true, color: '#1971c2', opacity: 0.4 });
    unwrap(await session.execute({ type: 'set-instance-appearance', instanceId: 'b1', appearance: {} }));
    expect(session.state().document.instances[0]).not.toHaveProperty('appearance');
    expect(await session.execute({ type: 'set-instance-appearance', instanceId: 'b1', appearance: { opacity: 2 } })).toMatchObject({ ok: false });
    expect(await session.execute({ type: 'set-instance-appearance', instanceId: 'x', appearance: {} })).toMatchObject({ ok: false });
  });

  it('hinges a link on the base: hole axes line up and the angle turns it', async () => {
    await arm([90]);
    expect(session.state().document.joints[0]?.name).toBe('Revolute 1');
    expect(where('l1', [5, 5, 2.5])).toEqual([10, 10, 2.5]);
    expect(where('l1', [35, 5, 2.5])).toEqual([10, 40, 2.5]);
    expect([...session.state().placed]).toEqual(['l1']);
    unwrap(await session.execute({ type: 'set-joint-values', jointId: 'hinge', values: [0] }));
    expect(where('l1', [35, 5, 2.5])).toEqual([40, 10, 2.5]);
    await session.undo();
    expect(where('l1', [35, 5, 2.5])).toEqual([10, 40, 2.5]);
  });

  it('keeps joint values within limits and refuses to move what a joint places', async () => {
    await arm([0]);
    unwrap(await session.execute({ type: 'edit-joint', joint: hinge([0], { limits: [{ min: -45, max: 45 }] }) }));
    unwrap(await session.execute({ type: 'set-joint-values', jointId: 'hinge', values: [120] }));
    expect(session.state().document.joints[0]?.values).toEqual([45]);
    const moved = await session.execute({ type: 'move-instance', instanceId: 'l1', transform: translation([1, 2, 3]) });
    expect(moved).toMatchObject({ ok: false, error: { code: 'placed-by-joint' } });
    unwrap(await session.execute({ type: 'ground-instance', instanceId: 'b1', grounded: false }));
    unwrap(await session.execute({ type: 'move-instance', instanceId: 'b1', transform: translation([0, 0, 100]) }));
    expect(where('l1', [5, 5, 2.5])).toEqual([10, 10, 102.5]); // the link follows its joint
  });

  it('previews joint values without changing the document, and plays motion studies', async () => {
    await arm([0]);
    const preview = unwrap(await session.previewJoint('hinge', [90]));
    expect(transformPoint(preview.get('l1') as Matrix4, [35, 5, 2.5])[1]).toBeCloseTo(40);
    expect(session.state().document.joints[0]?.values).toEqual([0]);
    const study = { id: 's1', name: '', duration: 1, keys: [{ time: 0, joint: 'hinge', values: [0] }, { time: 1, joint: 'hinge', values: [180] }] };
    unwrap(await session.execute({ type: 'add-study', study }));
    expect(session.state().document.motionStudies[0]?.name).toBe('Motion study 1');
    const frames = unwrap(await session.motion('s1', 4));
    expect(frames.map((f) => f.time)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(transformPoint(frames[2]?.poses['l1'] as Matrix4, [35, 5, 2.5]).map((v) => Math.round(v))).toEqual([10, 40, 3]);
  });

  it('finds the overlapping instances and exports the assembly with instance names', async () => {
    await arm([90]);
    const [overlap] = await session.interference();
    expect(overlap).toMatchObject({ a: 'b1', b: 'l1' });
    expect(overlap?.volume).toBeGreaterThan(0);
    unwrap(await session.exportAssembly('step'));
    expect(files.delivered[0]?.name).toBe('Arm.step');
    expect(new TextDecoder().decode(files.delivered[0]?.bytes)).toContain("'Link 1'");
    await session.saveRecording(new Uint8Array([1, 2]), 'Swing');
    expect(files.delivered[1]).toMatchObject({ name: 'Arm - Swing.webm', mediaType: 'video/webm' });
  });

  it('shares the assembly as glTF and USDZ at real size, its parts placed (CAD-180)', async () => {
    await arm([0]);
    unwrap(await session.exportViewer('glb'));
    expect(files.delivered.at(-1)).toMatchObject({ name: 'Arm.glb', mediaType: 'model/gltf-binary' });
    const bytes = files.delivered.at(-1)?.bytes as Uint8Array;
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true)))) as { nodes: { name: string }[]; accessors: { max?: number[] }[] };
    expect(json.nodes.map((n) => n.name)).toEqual(['Base 1', 'Link 1']);
    // Metres: the parts are tens of millimetres long.
    expect(Math.max(...json.accessors.flatMap((a) => a.max ?? []))).toBeLessThan(0.2);
    const file = unwrap(await session.viewerFile('usdz'));
    expect(file).toMatchObject({ name: 'Arm.usdz', mediaType: 'model/vnd.usdz+zip' });
  });

  it('removes joints and their motion keys with an instance, and marks deleted components missing', async () => {
    await arm([0]);
    unwrap(await session.execute({ type: 'add-study', study: { id: 's1', name: 'Swing', duration: 1, keys: [{ time: 0, joint: 'hinge', values: [0] }] } }));
    unwrap(await session.execute({ type: 'remove-instance', instanceId: 'l1' }));
    expect(session.state().document.joints).toEqual([]);
    expect(session.state().document.motionStudies[0]?.keys).toEqual([]);
    await documents.discard(base);
    events.publish('documentDeleted', { documentId: base });
    await until(() => session.state().components.get(base)?.status === 'missing');
  });

  it('uses imported 3D files like components', async () => {
    const bytes = cubeStl(10);
    await assets.keep({ id: asAssetId('cube-asset'), projectId: project, name: 'cube.stl', byteLength: bytes.length, bytes });
    await documents.store({ id: asDocumentId('cube'), projectId: project, kind: 'imported', name: 'Cube', createdAt: stamp, modifiedAt: stamp, schemaVersion: currentSchemaVersion, assetId: asAssetId('cube-asset'), format: 'stl', fileName: 'cube.stl', byteLength: bytes.length });
    unwrap(await insert('c1', asDocumentId('cube'), identity(), true));
    expect(session.state().components.get(asDocumentId('cube'))).toMatchObject({ name: 'Cube', status: 'ready' });
    expect(session.state().document.instances[0]?.name).toBe('Cube 1');
    expect(session.state().components.get(asDocumentId('cube'))?.bodies[0]?.faces).toHaveLength(6);
    // Without its instance, the file is no component of the assembly any more (CAD-135).
    unwrap(await session.execute({ type: 'remove-instance', instanceId: 'c1' }));
    expect(session.state().components.has(asDocumentId('cube'))).toBe(false);
  });

  it('places an enclosure on a circuit board by a mounting hole the board names (CAD-170)', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../../../e2e/fixtures/sensor-board.kicad_pcb', import.meta.url)));
    await assets.keep({ id: asAssetId('board-asset'), projectId: project, name: 'sensor-board.kicad_pcb', byteLength: bytes.length, bytes });
    const board = asDocumentId('board');
    await documents.store({ id: board, projectId: project, kind: 'imported', name: 'Sensor board', createdAt: stamp, modifiedAt: stamp, schemaVersion: currentSchemaVersion, assetId: asAssetId('board-asset'), format: 'kicad_pcb', fileName: 'sensor-board.kicad_pcb', byteLength: bytes.length });
    unwrap(await insert('pcb', board, identity(), true));
    const loaded = session.state().components.get(board);
    expect(loaded).toMatchObject({ status: 'ready' });
    // The board and its parts; the board's hole walls by the holes' names.
    expect(loaded?.bodies.map((b) => b.body)).toEqual(['import', 'import:2']);
    expect(loaded?.bodies[0]?.faces.map((f) => f.name)).toEqual(expect.arrayContaining(['hole:H1', 'hole:H2', 'hole:H3', 'hole:H4', 'board:top', 'board:bottom']));
    // The enclosure (a plate with a hole, here) sits with its hole on the board's mounting hole H3.
    unwrap(await insert('case', base, translation([0, 80, 0])));
    unwrap(
      await session.execute({
        type: 'add-joint',
        joint: { id: 'screw', name: '', type: 'rigid', a: { instance: 'pcb', ref: { kind: 'face', body: 'import', name: 'hole:H3' } }, b: { instance: 'case', ref: holeOf('base') }, flip: false, values: [], limits: [] },
      }),
    );
    expect(session.state().jointErrors.get('screw')).toBeUndefined();
    // H3 is 4 mm in from the board's right and top edges: (56, 4) from its lower left corner, halfway up its 1.6 mm.
    expect(where('case', [10, 10, 2.5])).toEqual([56, 4, 0.8]);
  });

  it('tilts joint frames about their x axis (CAD-113)', () => {
    const flat = { origin: [0, 0, 0] as const, u: [1, 0, 0] as const, v: [0, 1, 0] as const };
    const tilted = offsetFrame(flat, { translate: [0, 0, 5], angle: 0, tilt: 90 });
    const round = (p: readonly number[]) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0);
    // Moved 5 mm along the old normal, then v tipped onto the old normal: the joint axis now runs along −y.
    expect([round(tilted.origin), round(tilted.u), round(tilted.v)]).toEqual([[0, 0, 5], [1, 0, 0], [0, 0, 1]]);
    const both = offsetFrame(flat, { translate: [0, 0, 0], angle: 90, tilt: 90 });
    expect([round(both.u), round(both.v)]).toEqual([[0, 0, 1], [-1, 0, 0]]);
  });

  it('leans joint frames before the tilt, so the axis can point any way (CAD-118)', () => {
    const flat = { origin: [0, 0, 0] as const, u: [1, 0, 0] as const, v: [0, 1, 0] as const };
    const round = (p: readonly number[]) => p.map((x) => Math.round(x * 1e9) / 1e9 + 0);
    const axis = (f: { u: readonly number[]; v: readonly number[] }) => {
      const [[a, b, c], [d, e, g]] = [f.u, f.v] as [[number, number, number], [number, number, number]];
      return round([b * g - c * e, c * d - a * g, a * e - b * d]);
    };
    // Without a lean, a tilt only tips the axis towards −y; leaned a quarter first, towards +x.
    expect(axis(offsetFrame(flat, { translate: [0, 0, 0], angle: 0, tilt: 90 }))).toEqual([0, -1, 0]);
    expect(axis(offsetFrame(flat, { translate: [0, 0, 0], angle: 0, lean: 90, tilt: 90 }))).toEqual([1, 0, 0]);
    const s = Math.SQRT1_2;
    expect(axis(offsetFrame(flat, { translate: [0, 0, 0], angle: 30, lean: 45, tilt: 45 }))).toEqual(round([0.5, -0.5, s]));
  });

  it('moves joint origins by offsets and tells where each joint is', async () => {
    await arm([0]);
    // 10 mm up the hole's axis, and turned a quarter: like the angle at 90°, lifted.
    unwrap(await session.execute({ type: 'edit-joint', joint: hinge([0], { a: { instance: 'b1', ref: holeOf('base'), offset: { translate: [0, 0, 10], angle: 90 } } }) }));
    expect(where('l1', [5, 5, 2.5])).toEqual([10, 10, 12.5]);
    expect(where('l1', [35, 5, 2.5])).toEqual([10, 40, 12.5]);
    const frame = session.state().jointFrames.get('hinge');
    expect(frame?.origin.slice(0, 2).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([10, 10]);
  });

  it('measures between instances and weighs the whole assembly', async () => {
    await arm([90]);
    unwrap(await session.execute({ type: 'edit-joint', joint: hinge([90], { a: { instance: 'b1', ref: holeOf('base'), offset: { translate: [0, 0, 10], angle: 0 } } }) }));
    // The base's top (z = 5) and the lifted link's bottom (z = 10).
    const gap = unwrap(await session.measure([
      { instance: 'b1', kind: 'face', body: 'base', name: 'f:base:end' },
      { instance: 'l1', kind: 'face', body: 'link', name: 'f:link:start' },
    ]));
    expect(gap.distance).toBeCloseTo(5);
    expect(gap.angle).toBeCloseTo(0);
    const weight = await session.properties();
    const volume = 60 * 20 * 5 + 40 * 10 * 5 - 2 * Math.PI * 9 * 5;
    expect(weight.volume).toBeCloseTo(volume, 0);
    expect(weight.mass).toBeCloseTo((volume * 1.24) / 1000, 1);
    expect(weight.parts.map((p) => p.name)).toEqual(['Base 1', 'Link 1']);
    expect(weight.centerOfMass[2]).toBeGreaterThan(2.5);
  });

  it('weighs a part of two bodies by each one’s material, and lists both in the bill of materials (CAD-158)', async () => {
    // A PLA housing (60 × 20 × 5 less a ⌀6 hole) with a steel pin (10 × 10 × 5) of its own.
    const housing = await modeling.apply({ type: 'extrude', feature: 'housing', key: 'duo-housing', bodies: [], frame: originFrames.XY, profiles: [profile(rectangleLoop(0, 0, 60, 20, 'housing'), [circleLoop(10, 10, 3, 'housing-hole', false)])], distance: 5, direction: 'normal', operation: 'new-body' });
    const pin = await modeling.apply({ type: 'extrude', feature: 'pin', key: 'duo-pin', bodies: housing.bodies, frame: originFrames.XY, profiles: [profile(rectangleLoop(100, 0, 10, 10, 'pin'))], distance: 5, direction: 'normal', operation: 'new-body' });
    const duo = asDocumentId('duo');
    await documents.store({ ...component('duo', 'Duo'), bodyMaterials: { pin: { name: 'Steel', density: 7.85 } } });
    await assets.publishResult({ documentId: duo, projectId: project, stamp, bytes: await modeling.snapshot(pin.bodies) });
    unwrap(await insert('d1', duo, identity(), true));
    await until(() => session.state().components.get(duo)?.status === 'ready');
    const [plastic, steel] = [(60 * 20 - Math.PI * 9) * 5 * 1.24, 10 * 10 * 5 * 7.85].map((g) => g / 1000);
    const weight = await session.properties();
    expect(weight.mass).toBeCloseTo((plastic as number) + (steel as number), 3);
    expect(weight.parts).toMatchObject([{ instance: 'd1', material: 'PLA, Steel' }]);
    const [line] = await session.billOfMaterials();
    expect(line).toMatchObject({ component: 'Duo', material: 'PLA, Steel', mass: expect.closeTo((plastic as number) + (steel as number), 3) });
    unwrap(await session.exportAssembly('3mf'));
    const model = new TextDecoder().decode((await readZip(files.delivered.at(-1)?.bytes as Uint8Array)).get('3D/3dmodel.model'));
    expect(model).toContain('<base name="PLA" displaycolor="#B4B4B4FF"/><base name="Steel" displaycolor="#B4B4B4FF"/>');
  });

  it('repeats instances in rows, around axes and mirrored, following their originals', async () => {
    unwrap(await insert('b1', base, identity(), true));
    const row = { id: 'p1', name: '', kind: 'linear' as const, instances: ['b1'], direction: [0, 1, 0] as const, origin: [0, 0, 0] as const, count: 3, spacing: 30 };
    unwrap(await session.execute({ type: 'set-pattern', pattern: row }));
    expect(session.state().document.patterns?.[0]?.name).toBe('Linear pattern 1');
    expect([...session.state().copies.keys()]).toEqual(['p1/b1/1', 'p1/b1/2']);
    expect(where('p1/b1/2', [0, 0, 0])).toEqual([0, 60, 0]);
    // Around the Z axis through (100, 0): a quarter turn takes the origin to (100, -100).
    unwrap(await session.execute({ type: 'set-pattern', pattern: { ...row, id: 'p2', kind: 'circular', direction: [0, 0, 1], origin: [100, 0, 0], count: 2, spacing: 90 } }));
    expect(where('p2/b1/1', [0, 0, 0])).toEqual([100, -100, 0]);
    // Mirrored across the plane x = 100.
    unwrap(await session.execute({ type: 'set-pattern', pattern: { ...row, id: 'p3', kind: 'mirror', direction: [1, 0, 0], origin: [100, 0, 0] } }));
    expect(where('p3/b1/1', [10, 5, 0])).toEqual([190, 5, 0]);
    // Copies follow their original, and are exported with it.
    unwrap(await session.execute({ type: 'ground-instance', instanceId: 'b1', grounded: false }));
    unwrap(await session.execute({ type: 'move-instance', instanceId: 'b1', transform: translation([0, 0, 7]) }));
    expect(where('p1/b1/1', [0, 0, 0])).toEqual([0, 30, 7]);
    expect((await session.properties()).parts).toHaveLength(5);
    unwrap(await session.exportAssembly('step'));
    expect(new TextDecoder().decode(files.delivered.at(-1)?.bytes)).toContain("'Base 1 (copy 2)'");
    expect(await session.execute({ type: 'set-pattern', pattern: { ...row, count: 1 } })).toMatchObject({ ok: false });
    unwrap(await session.execute({ type: 'remove-instance', instanceId: 'b1' }));
    expect(session.state().document.patterns).toEqual([]);
  });

  it('reads a component again when another tab or window changed it', async () => {
    unwrap(await insert('b1', base, identity(), true));
    const later = '2026-10-14T12:00:00.000Z';
    await documents.store({ ...component('base', 'Base'), modifiedAt: later });
    await assets.publishResult({ documentId: base, projectId: project, stamp: later, bytes: await snapshotOfPlate('base', 90, 20, [10, 10]) });
    events.publish('documentChanged', { documentId: base });
    const width = () => {
      const xs = Array.from(session.state().components.get(base)?.bodies[0]?.positions ?? []).filter((_, i) => i % 3 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    await until(() => Math.abs(width() - 90) < 1e-6);
  });

  it('reads a component again when this process published a new result, or another wrote one unheard (CAD-116)', async () => {
    unwrap(await insert('b1', base, identity(), true));
    const width = () => {
      const xs = Array.from(session.state().components.get(base)?.bodies[0]?.positions ?? []).filter((_, i) => i % 3 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    // The design editor (or edit_component) saved and published it.
    const later = '2026-10-14T12:00:00.000Z';
    await documents.store({ ...component('base', 'Base'), modifiedAt: later });
    await assets.publishResult({ documentId: base, projectId: project, stamp: later, bytes: await snapshotOfPlate('base', 90, 20, [10, 10]) });
    events.publish('resultPublished', { documentId: base });
    await until(() => Math.abs(width() - 90) < 1e-6);
    // Another process did, without an event: caught up with on request, unchanged ones left alone.
    const latest = '2026-10-14T13:00:00.000Z';
    await documents.store({ ...component('base', 'Base'), modifiedAt: latest });
    await assets.publishResult({ documentId: base, projectId: project, stamp: latest, bytes: await snapshotOfPlate('base', 70, 20, [10, 10]) });
    expect(width()).toBeCloseTo(90);
    await session.catchUp();
    expect(width()).toBeCloseTo(70);
    const before = session.state().components.get(base);
    await session.catchUp();
    expect(session.state().components.get(base)).toBe(before);
  });

  it('gives an edited joint without a name its own or the default name (CAD-112)', async () => {
    await arm([0]);
    unwrap(await session.execute({ type: 'edit-joint', joint: { ...hinge([10]), name: '' } }));
    expect(session.state().document.joints[0]?.name).toBe('Revolute 1');
  });

  it('links joints: a second hinge turns with the first, the other way', async () => {
    await arm([0]);
    unwrap(await insert('l2', link, translation([0, 80, 0])));
    const second: Joint = { ...hinge([0]), id: 'hinge2', a: { instance: 'b1', ref: holeOf('base'), offset: { translate: [0, 0, 20], angle: 0 } }, b: { instance: 'l2', ref: holeOf('link') } };
    unwrap(await session.execute({ type: 'add-joint', joint: second }));
    const gear = { id: 'g', name: '', kind: 'gear' as const, driver: { joint: 'hinge', dof: 0 }, driven: { joint: 'hinge2', dof: 0 }, ratio: -2, offset: 0 };
    unwrap(await session.execute({ type: 'set-link', link: gear }));
    expect(session.state().document.links?.[0]?.name).toBe('Gear 1');
    unwrap(await session.execute({ type: 'set-joint-values', jointId: 'hinge', values: [30] }));
    expect(session.state().document.joints.find((j) => j.id === 'hinge2')?.values[0]).toBeCloseTo(-60);
    // Not in a circle, and not twice for one joint.
    expect(await session.execute({ type: 'set-link', link: { ...gear, id: 'back', driver: { joint: 'hinge2', dof: 0 }, driven: { joint: 'hinge', dof: 0 } } })).toMatchObject({ ok: false });
    unwrap(await session.execute({ type: 'remove-joint', jointId: 'hinge2' }));
    expect(session.state().document.links).toEqual([]);
  });

  it('finds where parts hit during a motion study', async () => {
    await arm([0]);
    const study = { id: 's1', name: '', duration: 1, keys: [{ time: 0, joint: 'hinge', values: [0] }, { time: 1, joint: 'hinge', values: [90] }] };
    unwrap(await session.execute({ type: 'add-study', study }));
    const { collisions: hits } = unwrap(await session.collisions('s1', 2));
    expect(hits[0]).toMatchObject({ a: 'b1', b: 'l1', time: 0 });
    expect(hits[0]?.volume).toBeGreaterThan(0);
  });

  it('moves pattern copies with their originals in studies, and checks them for collisions (CAD-115, CAD-114)', async () => {
    await arm([0]);
    // A copy of the link 20 mm above it, and a copy of the base 2 mm above the base (they overlap).
    unwrap(await session.execute({ type: 'set-pattern', pattern: { id: 'up', name: '', kind: 'linear', instances: ['l1'], direction: [0, 0, 1], origin: [0, 0, 0], count: 2, spacing: 20 } }));
    unwrap(await session.execute({ type: 'set-pattern', pattern: { id: 'stack', name: '', kind: 'linear', instances: ['b1'], direction: [0, 0, 1], origin: [0, 0, 0], count: 2, spacing: 2 } }));
    const study = { id: 's1', name: '', duration: 1, keys: [{ time: 0, joint: 'hinge', values: [0] }, { time: 1, joint: 'hinge', values: [90] }] };
    unwrap(await session.execute({ type: 'add-study', study }));
    const frames = unwrap(await session.motion('s1', 2));
    const last = frames.at(-1)?.poses as Record<string, Matrix4>;
    const tip = (id: string) => transformPoint(last[id] as Matrix4, [35, 5, 2.5]).map((v) => Math.round(v * 1e6) / 1e6);
    const [link, copy] = [tip('l1'), tip('up/l1/1')];
    expect(copy).toEqual([link[0], link[1], (link[2] as number) + 20]); // turned with the link, 20 mm higher
    const progress: number[] = [];
    const report = unwrap(await session.collisions('s1', 2, { onProgress: (done) => progress.push(done) }));
    expect(report).toMatchObject({ checked: 3, moments: 3 });
    expect(progress).toEqual([1, 2, 3]);
    expect(report.collisions.some((c) => [c.a, c.b].includes('stack/b1/1') && [c.a, c.b].includes('b1'))).toBe(true);
  });

  it('explodes the assembly step by step, lists its parts, and makes build instructions', async () => {
    await arm([90]);
    const view = { id: 'v1', name: '', steps: [{ id: 's1', instances: ['l1'], direction: [0, 0, 1] as const, distance: 50 }] };
    unwrap(await session.execute({ type: 'set-exploded-view', view }));
    expect(session.state().document.explodedViews?.[0]?.name).toBe('Exploded view 1');
    const lifted = (poses: ReadonlyMap<string, Matrix4>) => transformPoint(poses.get('l1') as Matrix4, [5, 5, 2.5])[2];
    expect(lifted(session.explode('v1'))).toBeCloseTo(52.5);
    expect(lifted(session.explode('v1', 1, 0.5))).toBeCloseTo(27.5);
    expect(lifted(session.explode('v1', 0))).toBeCloseTo(2.5);

    unwrap(await session.execute({ type: 'set-pattern', pattern: { id: 'p', name: '', kind: 'linear', instances: ['b1'], direction: [0, 1, 0], origin: [0, 0, 0], count: 2, spacing: 100 } }));
    // Steps move pattern copies too, and a radial step moves each part away from an axis (CAD-110).
    const refused = await session.execute({ type: 'set-exploded-view', view: { ...view, steps: [{ ...view.steps[0], id: 's2', instances: ['p/b1/7'] }] } as never });
    expect(refused).toMatchObject({ ok: false, error: { message: '"p/b1/7" is not an instance or a pattern copy of this assembly.' } });
    const radial = { id: 'v2', name: '', steps: [{ id: 's', instances: ['b1', 'p/b1/1'], direction: [1, 0, 0] as const, distance: 10, radial: true, origin: [0, 60, 2.5] as const }] };
    unwrap(await session.execute({ type: 'set-exploded-view', view: radial }));
    const apart = session.explode('v2');
    const middle = (id: string) => transformPoint(apart.get(id) as Matrix4, [30, 10, 2.5]).map((v) => Math.round(v * 1e6) / 1e6 + 0);
    // The plates' middles are at y 10 and 110: 50 mm either side of the axis (along x, through y 60, z 2.5); each moves 10 mm away.
    expect(middle('b1')).toEqual([30, 0, 2.5]);
    expect(middle('p/b1/1')).toEqual([30, 120, 2.5]);
    const bom = await session.billOfMaterials();
    expect(bom.map((l) => [l.component, l.count])).toEqual([
      ['Base', 2],
      ['Link', 1],
    ]);
    expect(bom[0]?.mass).toBeCloseTo(((60 * 20 * 5 - Math.PI * 9 * 5) * 1.24) / 1000, 1);
    unwrap(await session.exportBillOfMaterials());
    const csv = new TextDecoder().decode(files.delivered.at(-1)?.bytes);
    expect(csv.split('\r\n')[0]).toBe('Component,Configuration,Count,Material,Mass each (g),Mass (g)');
    expect(csv).toContain('Base,,2,');

    const jpeg = { jpeg: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), width: 4, height: 3 };
    unwrap(await session.exportInstructions('v1', [jpeg, jpeg]));
    const pdf = files.delivered.at(-1);
    expect(pdf?.name).toBe('Arm - Exploded view 1.pdf');
    const text = Array.from(pdf?.bytes ?? [], (c) => String.fromCharCode(c)).join('');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 3'); // the parts, one step, finished
    expect(await session.exportInstructions('v1', [jpeg])).toMatchObject({ ok: false });
  });

  it('refuses joints that cannot hold, with the reason', async () => {
    unwrap(await insert('b1', base, identity(), true));
    unwrap(await insert('l1', link));
    await until(() => session.state().components.get(link)?.status === 'ready');
    const flat = await session.execute({ type: 'add-joint', joint: hinge([0], { b: { instance: 'l1', ref: { kind: 'face', body: 'link', name: 'nope' } } }) });
    expect(flat).toMatchObject({ ok: false, error: { code: 'joint-failed', message: expect.stringContaining('no longer exists') } });
    const wrongValues = await session.execute({ type: 'add-joint', joint: hinge([0, 1]) });
    expect(wrongValues).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
  });
});
