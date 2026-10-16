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
    expect(width(link)).toBeCloseTo(40);
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
    const hits = unwrap(await session.collisions('s1', 2));
    expect(hits[0]).toMatchObject({ a: 'b1', b: 'l1', time: 0 });
    expect(hits[0]?.volume).toBeGreaterThan(0);
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
