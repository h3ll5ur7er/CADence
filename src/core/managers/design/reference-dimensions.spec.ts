import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { createShapeAccess } from '@core/access/shape';
import { asDocumentId, asProjectId, currentSchemaVersion, type DomainEvents, isDimension, type Result, sketchOriginId } from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignManager, type DesignSession } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const sketchEngine = createSketchEngine();
const shapes = createShapeAccess();
const modeling = createModelingEngine(shapes);

describe('Reference dimensions (CAD-153)', () => {
  let session: DesignSession;

  beforeEach(async () => {
    const projects = new InMemoryProjectAccess();
    await projects.establish({ id: asProjectId('p1'), name: 'Project', createdAt: '2026-10-14T10:00:00.000Z', modifiedAt: '2026-10-14T10:00:00.000Z' });
    const documents = new InMemoryDocumentAccess();
    await documents.store({
      id: asDocumentId('d1'),
      projectId: asProjectId('p1'),
      kind: 'component',
      name: 'Component 1',
      createdAt: '2026-10-14T10:00:00.000Z',
      modifiedAt: '2026-10-14T10:00:00.000Z',
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
      sketches: sketchEngine,
      parameters: createParameterEngine(),
      modeling,
      interchange: createInterchangeEngine(shapes),
      analysis: createAnalysisEngine(shapes),
      assets: new InMemoryAssetAccess(),
      events: new EventBus<DomainEvents>(),
      clock: steppingClock('2026-10-14T11:00:00.000Z'),
    });
    session = unwrap(await manager.open(asDocumentId('d1')));
    // A fully defined 40 x 20 rectangle at the origin, with its diagonal as construction.
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 's1',
        entities: [
          { id: 'a', kind: 'point', x: 0, y: 0 },
          { id: 'b', kind: 'point', x: 38, y: 1 },
          { id: 'c', kind: 'point', x: 38, y: 21 },
          { id: 'd', kind: 'point', x: 0, y: 21 },
          { id: 'ab', kind: 'line', start: 'a', end: 'b', construction: false },
          { id: 'bc', kind: 'line', start: 'b', end: 'c', construction: false },
          { id: 'cd', kind: 'line', start: 'c', end: 'd', construction: false },
          { id: 'da', kind: 'line', start: 'd', end: 'a', construction: false },
          { id: 'ac', kind: 'line', start: 'a', end: 'c', construction: true },
        ],
        constraints: [
          { id: 'o', kind: 'coincident', points: ['a', sketchOriginId] },
          { id: 'h1', kind: 'horizontal', line: 'ab' },
          { id: 'h2', kind: 'horizontal', line: 'cd' },
          { id: 'v1', kind: 'vertical', line: 'bc' },
          { id: 'v2', kind: 'vertical', line: 'da' },
          { id: 'w', kind: 'distance', points: ['a', 'b'], expression: '40' },
          { id: 'h', kind: 'distance', points: ['b', 'c'], expression: '20' },
        ],
      }),
    );
  });

  const view = () => session.state().sketches.get('s1');

  it('adds no constraint, shows what it measures and follows a changed sketch', async () => {
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'diag', kind: 'distance', points: ['a', 'c'], expression: '', reference: true } }));
    expect(view()?.status).toBe('fully-constrained');
    expect(view()?.degreesOfFreedom).toBe(0);
    expect(view()?.values.get('diag')).toBeCloseTo(Math.hypot(40, 20));

    unwrap(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'w', expression: '60' }));
    expect(view()?.values.get('diag')).toBeCloseTo(Math.hypot(60, 20));
    // Previews of drags measure as they go.
    unwrap(await session.execute({ type: 'delete-sketch-elements', sketchId: 's1', ids: ['h'] }));
    const dragged = await session.previewDrag('s1', 'c', 60, 45);
    expect(dragged?.values.get('diag')).toBeCloseTo(Math.hypot(60, 45));
  });

  it('measures angles, radii and distances to lines', async () => {
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 's1',
        entities: [{ id: 'circle', kind: 'circle', center: 'c', radius: 5, construction: false }],
        constraints: [
          { id: 'r', kind: 'diameter', curve: 'circle', expression: '10' },
          { id: 'angle', kind: 'angle', lines: ['ab', 'ac'], expression: '', reference: true },
          { id: 'radius', kind: 'radius', curve: 'circle', expression: '', reference: true },
          { id: 'across', kind: 'point-line-distance', point: 'c', line: 'ab', expression: '', reference: true },
        ],
      }),
    );
    expect(view()?.values.get('angle')).toBeCloseTo(Math.atan2(20, 40));
    expect(view()?.values.get('radius')).toBeCloseTo(5);
    expect(view()?.values.get('across')).toBeCloseTo(20);
  });

  it('turns a dimension that would over-constrain into a reference, and back into a driving one at its value', async () => {
    const refused = await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w2', kind: 'horizontal-distance', points: ['a', 'b'], expression: '40' } });
    expect(refused).toMatchObject({ ok: false, error: { code: 'over-constrained' } });
    if (!refused.ok) expect(refused.error.message).toContain('reference dimension');
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w2', kind: 'horizontal-distance', points: ['a', 'b'], expression: '40', reference: true } }));
    expect(view()?.values.get('w2')).toBeCloseTo(40);

    // Width as a reference, height as driving: the old width stays as the value it shows.
    unwrap(await session.execute({ type: 'set-dimension-reference', sketchId: 's1', constraintId: 'w', reference: true }));
    expect(view()?.degreesOfFreedom).toBe(1);
    expect(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'w', expression: '10' })).toMatchObject({ ok: false });
    unwrap(await session.execute({ type: 'set-dimension-reference', sketchId: 's1', constraintId: 'w2', reference: false }));
    const w2 = view()?.sketch.constraints.find((c) => c.id === 'w2');
    expect(w2 && isDimension(w2) ? [w2.expression, w2.reference] : undefined).toEqual(['40 mm', undefined]);
    expect(view()?.status).toBe('fully-constrained');
  });

  it('lets later items and parameters read a named reference, and refuses one that would drive what it measures', async () => {
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'diag', kind: 'distance', points: ['a', 'c'], expression: '', reference: true, name: 'diagonal' } }));
    unwrap(await session.execute({ type: 'add-parameter', parameter: { id: 'p1', name: 'half', expression: 'diagonal / 2' } }));
    expect(session.state().parameters.find((p) => p.parameter.name === 'diagonal')).toMatchObject({ measured: 'Sketch 1', display: '44.721 mm' });
    expect(session.state().parameters.find((p) => p.parameter.name === 'half')?.display).toBe('22.361 mm');

    // A later sketch reads it; it follows when the first sketch changes.
    unwrap(await session.execute({ type: 'create-sketch', id: 's2', plane: 'XY' }));
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 's2',
        entities: [
          { id: 'p', kind: 'point', x: 0, y: 0 },
          { id: 'q', kind: 'point', x: 10, y: 0 },
          { id: 'pq', kind: 'line', start: 'p', end: 'q', construction: false },
        ],
        constraints: [{ id: 'len', kind: 'distance', points: ['p', 'q'], expression: 'half' }],
      }),
    );
    expect(session.state().sketches.get('s2')?.values.get('len')).toBeCloseTo(Math.hypot(40, 20) / 2);
    unwrap(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'h', expression: '30' }));
    expect(session.state().sketches.get('s2')?.values.get('len')).toBeCloseTo(Math.hypot(40, 30) / 2);

    // Its own sketch cannot use it.
    const loop = await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'w', expression: 'half' });
    expect(loop).toMatchObject({ ok: false });
    if (!loop.ok) expect(loop.error.message).toContain('a reference cannot drive what it measures');
    // Nor may its name repeat a parameter's.
    expect(await session.execute({ type: 'set-dimension-reference', sketchId: 's1', constraintId: 'diag', reference: true, name: 'half' })).toMatchObject({ ok: false });
  });
});
