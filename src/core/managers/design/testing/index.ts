import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { createShapeAccess } from '@core/access/shape';
import { asDocumentId, asProjectId, currentSchemaVersion, type DomainEvents, type Feature, type PartSpec, type PlaneRef, type Result } from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { createDesignManager, type DesignSession } from '../index';

/** The value of a result, or a failed test. */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Where a test part goes: a point of a new sketch on `plane`, turned, flipped, and how it combines. */
export interface Placing {
  readonly plane?: PlaneRef;
  readonly at?: readonly [number, number];
  readonly angle?: string;
  readonly flip?: boolean;
  readonly operation?: 'new-body' | 'intersect';
}

/**
 * A session on an empty component with the real kernel, for tests of parts (phase 37), and helpers to
 * add parts and measure how much two of them overlap. Heavy parts (gears, worms) fill the kernel's
 * memory: each spec file gets its own kernel.
 */
export async function partSession() {
  const shapes = createShapeAccess();
  const projects = new InMemoryProjectAccess();
  await projects.establish({ id: asProjectId('p1'), name: 'Project', createdAt: '2026-10-21T10:00:00.000Z', modifiedAt: '2026-10-21T10:00:00.000Z' });
  const documents = new InMemoryDocumentAccess();
  await documents.store({
    id: asDocumentId('d1'),
    projectId: asProjectId('p1'),
    kind: 'component',
    name: 'Component 1',
    createdAt: '2026-10-21T10:00:00.000Z',
    modifiedAt: '2026-10-21T10:00:00.000Z',
    schemaVersion: currentSchemaVersion,
    units: 'mm',
    parameters: [],
    timeline: [],
    rollbackIndex: 0,
  });
  const manager = createDesignManager({
    projects,
    documents,
    externalFiles: new InMemoryExternalFileAccess(),
    sketches: createSketchEngine(),
    parameters: createParameterEngine(),
    modeling: createModelingEngine(shapes),
    interchange: createInterchangeEngine(shapes),
    analysis: createAnalysisEngine(shapes),
    assets: new InMemoryAssetAccess(),
    events: new EventBus<DomainEvents>(),
    clock: steppingClock('2026-10-21T11:00:00.000Z'),
  });
  const session: DesignSession = unwrap(await manager.open(asDocumentId('d1')));
  const volume = async () => (await session.properties()).reduce((sum, b) => sum + b.volume, 0);
  const add = async (feature: Feature) => unwrap(await session.execute({ type: 'add-feature', feature }));
  /** A part at a point of a new sketch; its id is `id`, its sketch's `<id>-sketch`. */
  const part = async (id: string, spec: PartSpec, placing: Placing = {}) => {
    const [x, y] = placing.at ?? [0, 0];
    unwrap(await session.execute({ type: 'create-sketch', id: `${id}-sketch`, plane: placing.plane ?? 'XY' }));
    unwrap(await session.execute({ type: 'add-sketch-geometry', sketchId: `${id}-sketch`, entities: [{ id: `${id}-at`, kind: 'point', x, y }], constraints: [] }));
    await add({ id, type: 'part', name: '', suppressed: false, part: spec, sketch: `${id}-sketch`, points: [`${id}-at`], angle: placing.angle ?? '0 deg', flip: placing.flip ?? false, operation: placing.operation ?? 'new-body' });
    return session.state().items.get(id);
  };
  /** What overlaps the bodies so far when a part is added to intersect them; the part goes again. */
  const overlap = async (id: string, spec: PartSpec, placing: Placing = {}) => {
    await part(id, spec, { ...placing, operation: 'intersect' });
    const left = await volume();
    unwrap(await session.execute({ type: 'delete-item', itemId: id }));
    unwrap(await session.execute({ type: 'delete-item', itemId: `${id}-sketch` }));
    return left;
  };
  return { session, volume, add, part, overlap };
}
