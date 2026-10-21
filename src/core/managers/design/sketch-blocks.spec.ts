import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { createShapeAccess } from '@core/access/shape';
import { asDocumentId, asProjectId, currentSchemaVersion, type DocumentId, type DomainEvents, type Result, type SketchPoint } from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignManager, type DesignManager, type DesignSession } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const sketchEngine = createSketchEngine();
const shapes = createShapeAccess();
const modeling = createModelingEngine(shapes);

/** A 10 x 4 slot-like rectangle with a hole, its corner at (x, y). */
const slot = (x: number, y: number) => ({
  entities: [
    { id: 'a', kind: 'point' as const, x, y },
    { id: 'b', kind: 'point' as const, x: x + 10, y },
    { id: 'c', kind: 'point' as const, x: x + 10, y: y + 4 },
    { id: 'd', kind: 'point' as const, x, y: y + 4 },
    { id: 'ab', kind: 'line' as const, start: 'a', end: 'b', construction: false },
    { id: 'bc', kind: 'line' as const, start: 'b', end: 'c', construction: false },
    { id: 'cd', kind: 'line' as const, start: 'c', end: 'd', construction: false },
    { id: 'da', kind: 'line' as const, start: 'd', end: 'a', construction: false },
  ],
  constraints: [
    { id: 'h1', kind: 'horizontal' as const, line: 'ab' },
    { id: 'h2', kind: 'horizontal' as const, line: 'cd' },
    { id: 'v1', kind: 'vertical' as const, line: 'bc' },
    { id: 'v2', kind: 'vertical' as const, line: 'da' },
    { id: 'w', kind: 'distance' as const, points: ['a', 'b'] as const, expression: '10' },
    { id: 'h', kind: 'distance' as const, points: ['b', 'c'] as const, expression: '4' },
  ],
});

describe('Sketch blocks (CAD-154)', () => {
  let documents: InMemoryDocumentAccess;
  let assets: InMemoryAssetAccess;
  let events: EventBus<DomainEvents>;
  let manager: DesignManager;
  let session: DesignSession;

  const component = (id: string, name: string) =>
    documents.store({
      id: asDocumentId(id),
      projectId: asProjectId('p1'),
      kind: 'component',
      name,
      createdAt: '2026-10-14T10:00:00.000Z',
      modifiedAt: '2026-10-14T10:00:00.000Z',
      schemaVersion: currentSchemaVersion,
      units: 'mm',
      parameters: [],
      timeline: [],
      rollbackIndex: 0,
    });

  beforeEach(async () => {
    const projects = new InMemoryProjectAccess();
    await projects.establish({ id: asProjectId('p1'), name: 'Project', createdAt: '2026-10-14T10:00:00.000Z', modifiedAt: '2026-10-14T10:00:00.000Z' });
    documents = new InMemoryDocumentAccess();
    assets = new InMemoryAssetAccess();
    events = new EventBus<DomainEvents>();
    await component('d1', 'Panel');
    await component('d2', 'Lid');
    manager = createDesignManager({
      projects,
      documents,
      externalFiles: new InMemoryExternalFileAccess(),
      sketches: sketchEngine,
      parameters: createParameterEngine(),
      modeling,
      interchange: createInterchangeEngine(shapes),
      analysis: createAnalysisEngine(shapes),
      assets,
      events,
      clock: steppingClock('2026-10-14T11:00:00.000Z'),
    });
    session = unwrap(await manager.open(asDocumentId('d1')));
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(await session.execute({ type: 'add-sketch-geometry', sketchId: 's1', ...slot(20, 10) }));
  });

  const view = (s: DesignSession, id = 's1') => s.state().sketches.get(id);
  const point = (s: DesignSession, sketch: string, id: string) => {
    const p = view(s, sketch)?.sketch.entities.find((e): e is SketchPoint => e.id === id && e.kind === 'point');
    return p ? [p.x, p.y] : undefined;
  };

  it('makes a block from a selection, placed where it was', async () => {
    unwrap(await session.execute({ type: 'make-block', sketchId: 's1', block: 'slot', name: 'Slot', ids: ['ab', 'bc', 'cd', 'da'], base: [20, 10], insertion: 'i1' }));
    const timeline = session.state().document.timeline;
    expect(timeline.map((item) => [item.id, item.name])).toEqual([['slot', 'Slot'], ['s1', 'Sketch 1']]);
    // The block's origin is the chosen point; it keeps its relations and dimensions.
    expect(point(session, 'slot', 'a')).toEqual([expect.closeTo(0), expect.closeTo(0)]);
    expect(view(session, 'slot')?.sketch.constraints).toHaveLength(7); // and its corner on the origin
    expect(view(session, 'slot')?.status).toBe('fully-constrained');
    // The sketch places it on one point: two freedoms, its geometry fixed where it was.
    expect(view(session)?.degreesOfFreedom).toBe(2);
    expect(point(session, 's1', 'i1:c')).toEqual([expect.closeTo(30), expect.closeTo(14)]);
    expect(view(session)?.profiles).toHaveLength(1);
    expect(await session.blocks()).toEqual([{ sketch: 'slot', name: 'Slot' }]);
    // The sketch uses the block: the block cannot move after it.
    expect(await session.execute({ type: 'reorder-item', itemId: 'slot', index: 1 })).toMatchObject({ ok: false });
  });

  it('places a block twice, turned and scaled, and both follow when it is edited once', async () => {
    unwrap(await session.execute({ type: 'make-block', sketchId: 's1', block: 'slot', ids: ['ab', 'bc', 'cd', 'da'], base: [20, 10], insertion: 'i1' }));
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 's1',
        entities: [
          { id: 'o2', kind: 'point', x: 60, y: 0 },
          { id: 'i2', kind: 'block', block: 'slot', origin: 'o2', angle: '90 deg', scale: '2', construction: false },
        ],
        constraints: [],
      }),
    );
    expect(view(session)?.profiles).toHaveLength(2);
    // Turned a quarter and twice the size: the far corner (10, 4) goes to (60 - 8, 20).
    expect(point(session, 's1', 'i2:c')).toEqual([expect.closeTo(52), expect.closeTo(20)]);

    // Edited once, in the block: both placements follow.
    unwrap(await session.execute({ type: 'set-dimension', sketchId: 'slot', constraintId: 'w', expression: '16' }));
    expect(point(session, 's1', 'i1:b')).toEqual([expect.closeTo(36), expect.closeTo(10)]);
    expect(point(session, 's1', 'i2:b')).toEqual([expect.closeTo(60), expect.closeTo(32)]);
    expect(view(session)?.profiles.map((p) => Math.round(p.area)).sort()).toEqual([256, 64]);

    // Placements move by their point, and turn and scale by their values.
    unwrap(await session.execute({ type: 'move-point', sketchId: 's1', pointId: 'o2', x: 70, y: 5 }));
    expect(point(session, 's1', 'i2:a')).toEqual([expect.closeTo(70), expect.closeTo(5)]);
    unwrap(await session.execute({ type: 'set-block', sketchId: 's1', insertion: 'i2', angle: '0 deg', scale: '1' }));
    expect(point(session, 's1', 'i2:c')).toEqual([expect.closeTo(86), expect.closeTo(9)]);
    expect(await session.execute({ type: 'set-block', sketchId: 's1', insertion: 'i2', angle: '0', scale: '0' })).toMatchObject({ ok: false });
  });

  it('explodes a placement into plain curves that no longer follow the block', async () => {
    unwrap(await session.execute({ type: 'make-block', sketchId: 's1', block: 'slot', ids: ['ab', 'bc', 'cd', 'da'], base: [20, 10], insertion: 'i1' }));
    unwrap(await session.execute({ type: 'explode-block', sketchId: 's1', insertion: 'i1' }));
    expect(view(session)?.sketch.entities.some((e) => e.kind === 'block')).toBe(false);
    expect(point(session, 's1', 'i1.c')).toEqual([expect.closeTo(30), expect.closeTo(14)]);
    expect(view(session)?.degreesOfFreedom).toBeGreaterThan(2);
    unwrap(await session.execute({ type: 'set-dimension', sketchId: 'slot', constraintId: 'w', expression: '16' }));
    expect(point(session, 's1', 'i1.b')).toEqual([expect.closeTo(30), expect.closeTo(10)]);
  });

  it('places blocks of another component of the project, which follow when it changes there', async () => {
    unwrap(await session.execute({ type: 'make-block', sketchId: 's1', block: 'slot', name: 'Slot', ids: ['ab', 'bc', 'cd', 'da'], base: [20, 10], insertion: 'i1' }));
    const lid = unwrap(await manager.open(asDocumentId('d2')));
    lid.subscribe(() => undefined);
    expect(await lid.blocks()).toEqual([{ sketch: 'slot', name: 'Slot', document: 'd1', documentName: 'Panel' }]);
    unwrap(await lid.execute({ type: 'create-sketch', id: 'top', plane: 'XY' }));
    unwrap(
      await lid.execute({
        type: 'add-sketch-geometry',
        sketchId: 'top',
        entities: [
          { id: 'o', kind: 'point', x: 0, y: 0 },
          { id: 'b', kind: 'block', block: 'slot', document: 'd1', origin: 'o', angle: '0 deg', scale: '1', construction: false },
        ],
        constraints: [],
      }),
    );
    expect(point(lid, 'top', 'b:c')).toEqual([expect.closeTo(10), expect.closeTo(4)]);
    // A component not open anywhere, that places it too, with a result made before.
    const closed = (await documents.load(asDocumentId('d2'))) as Extract<Awaited<ReturnType<typeof documents.load>>, { kind: 'component' }>;
    await documents.store({ ...closed, id: asDocumentId('d3'), name: 'Base' });
    await assets.publishResult({ documentId: 'd3' as DocumentId, projectId: asProjectId('p1'), stamp: 'x', bytes: new Uint8Array([1]) });

    unwrap(await session.execute({ type: 'set-dimension', sketchId: 'slot', constraintId: 'h', expression: '6' }));
    await lid.catchUp();
    expect(point(lid, 'top', 'b:c')).toEqual([expect.closeTo(10), expect.closeTo(6)]);
    // The result made with the old block is gone, so assemblies and drawings ask for a new one.
    expect(await assets.latestResult('d3' as DocumentId)).toBeUndefined();
    expect(await lid.execute({ type: 'add-sketch-geometry', sketchId: 'top', entities: [{ id: 'p', kind: 'point', x: 1, y: 1 }, { id: 'x', kind: 'block', block: 'nope', origin: 'p', angle: '0', scale: '1', construction: false }], constraints: [] })).toMatchObject({ ok: false });
  });
});
