import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
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
    key: `assembly-${feature}`,
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
    await documents.store(component('link', 'Link'));
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
    events.subscribe('regenerateComponent', async ({ documentId }) => {
      if (documentId === link) await assets.publishResult({ documentId, projectId: project, stamp, bytes: await snapshotOfPlate('link', 40, 10, [5, 5]) });
      events.publish('componentRegenerated', { documentId, ok: documentId === link });
    });
    const manager = createAssemblyManager({
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
