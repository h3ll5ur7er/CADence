import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { createShapeAccess } from '@core/access/shape';
import {
  asDocumentId,
  asProjectId,
  type ComponentDocument,
  currentSchemaVersion,
  type Result,
  type SketchPoint,
  sketchOriginId,
} from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { steppingClock } from '@core/utilities/clock';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDesignManager, type DesignSession } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const sketchEngine = createSketchEngine();
const shapes = createShapeAccess();
const modeling = createModelingEngine(shapes);
const interchange = createInterchangeEngine(shapes);

describe('DesignManager', () => {
  let documents: InMemoryDocumentAccess;
  let files: InMemoryExternalFileAccess;
  let session: DesignSession;
  let documentId: ComponentDocument['id'];

  beforeEach(async () => {
    documents = new InMemoryDocumentAccess();
    files = new InMemoryExternalFileAccess();
    documentId = asDocumentId('d1');
    await documents.store({
      id: documentId,
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
      documents,
      externalFiles: files,
      sketches: sketchEngine,
      parameters: createParameterEngine(),
      modeling,
      interchange,
      clock: steppingClock('2026-10-14T11:00:00.000Z'),
    });
    session = unwrap(await manager.open(documentId));
  });

  const sketch = () => session.state().sketches.get('s1');
  const pointAt = (id: string) => {
    const p = sketch()?.sketch.entities.find((e): e is SketchPoint => e.id === id && e.kind === 'point');
    return p ? [p.x, p.y] : undefined;
  };

  /** A rectangle as the rectangle tool creates it: 4 points, 4 lines, horizontal and vertical relations. */
  async function drawRectangle(): Promise<void> {
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(
      await session.execute({
        type: 'add-sketch-geometry',
        sketchId: 's1',
        entities: [
          { id: 'a', kind: 'point', x: 2, y: 1 },
          { id: 'b', kind: 'point', x: 30, y: 1 },
          { id: 'c', kind: 'point', x: 30, y: 16 },
          { id: 'd', kind: 'point', x: 2, y: 16 },
          { id: 'ab', kind: 'line', start: 'a', end: 'b', construction: false },
          { id: 'bc', kind: 'line', start: 'b', end: 'c', construction: false },
          { id: 'cd', kind: 'line', start: 'c', end: 'd', construction: false },
          { id: 'da', kind: 'line', start: 'd', end: 'a', construction: false },
        ],
        constraints: [
          { id: 'h1', kind: 'horizontal', line: 'ab' },
          { id: 'h2', kind: 'horizontal', line: 'cd' },
          { id: 'v1', kind: 'vertical', line: 'bc' },
          { id: 'v2', kind: 'vertical', line: 'da' },
        ],
      }),
    );
  }

  it('opens an empty component', () => {
    expect(session.state().document.timeline).toEqual([]);
    expect(session.state().canUndo).toBe(false);
  });

  it('creates numbered sketches on origin planes and saves them', async () => {
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(await session.execute({ type: 'create-sketch', id: 's2', plane: 'XZ' }));
    expect(session.state().document.timeline.map((i) => [i.name, i.plane])).toEqual([
      ['Sketch 1', 'XY'],
      ['Sketch 2', 'XZ'],
    ]);
    const saved = (await documents.load(documentId)) as ComponentDocument;
    expect(saved.timeline).toHaveLength(2);
  });

  it('solves drawn geometry and finds its profile', async () => {
    await drawRectangle();
    expect(sketch()?.status).toBe('under-constrained');
    expect(sketch()?.profiles).toHaveLength(1);
  });

  it('drives geometry with dimensions and expressions', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'o', kind: 'coincident', points: ['a', sketchOriginId] } }));
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'distance', points: ['a', 'b'], expression: '40' } }));
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'h', kind: 'distance', points: ['b', 'c'], expression: '1 in' } }));
    expect(sketch()?.status).toBe('fully-constrained');
    expect(pointAt('c')).toEqual([expect.closeTo(40), expect.closeTo(25.4)]);

    unwrap(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'w', expression: '2 * 30 mm' }));
    expect(pointAt('b')).toEqual([expect.closeTo(60), expect.closeTo(0)]);
    expect(sketch()?.values.get('w')).toBeCloseTo(60);
    expect(sketch()?.profiles[0]?.area).toBeCloseTo(60 * 25.4);
  });

  it('rejects invalid expressions and conflicts, keeping the document as it was', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'distance', points: ['a', 'b'], expression: '40' } }));
    const before = session.state().document;

    const invalid = await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'w', expression: '40 +' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid-expression' } });

    const conflict = await session.execute({
      type: 'add-constraint',
      sketchId: 's1',
      constraint: { id: 'w2', kind: 'distance', points: ['a', 'b'], expression: '50' },
    });
    expect(conflict).toMatchObject({ ok: false, error: { code: 'over-constrained' } });
    expect(session.state().document).toBe(before);
  });

  it('refuses changes that would collapse a curve to nothing', async () => {
    await drawRectangle();
    const collapse = await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'v3', kind: 'vertical', line: 'ab' } });
    expect(collapse).toMatchObject({ ok: false, error: { code: 'degenerate' } });
    expect(sketch()?.sketch.constraints.some((c) => c.id === 'v3')).toBe(false);
  });

  it('undoes and redoes changes', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'distance', points: ['a', 'b'], expression: '40' } }));
    await session.undo();
    expect(sketch()?.sketch.constraints.some((c) => c.id === 'w')).toBe(false);
    expect(pointAt('b')).toEqual([30, 1]);
    await session.redo();
    expect(sketch()?.values.get('w')).toBe(40);
    await session.undo();
    await session.undo();
    await session.undo();
    expect(session.state().document.timeline).toEqual([]);
    expect(session.state().canUndo).toBe(false);
    expect(((await documents.load(documentId)) as ComponentDocument).timeline).toEqual([]);
  });

  it('moves points within the constraints and previews drags without saving', async () => {
    await drawRectangle();
    const preview = await session.previewDrag('s1', 'c', 50, 40);
    const moved = preview?.sketch.entities.find((e): e is SketchPoint => e.id === 'b');
    expect(moved?.x).toBeCloseTo(50); // b follows c: vertical right side
    expect(pointAt('c')).toEqual([30, 16]);

    unwrap(await session.execute({ type: 'move-point', sketchId: 's1', pointId: 'c', x: 50, y: 40 }));
    expect(pointAt('c')).toEqual([expect.closeTo(50), expect.closeTo(40)]);
    expect(pointAt('d')?.[1]).toBeCloseTo(40); // d follows c: horizontal top side
  });

  it('deletes curves with their relations and orphaned points', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'delete-sketch-elements', sketchId: 's1', ids: ['ab'] }));
    const s = sketch()?.sketch;
    expect(s?.entities.map((e) => e.id).sort()).toEqual(['a', 'b', 'bc', 'c', 'cd', 'd', 'da']);
    expect(s?.constraints.map((c) => c.id).sort()).toEqual(['h2', 'v1', 'v2']);
    expect(sketch()?.profiles).toHaveLength(0);

    unwrap(await session.execute({ type: 'delete-sketch-elements', sketchId: 's1', ids: ['bc'] }));
    expect(sketch()?.sketch.entities.some((e) => e.id === 'b')).toBe(false);
  });

  it('turns curves into construction geometry and back', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'toggle-construction', sketchId: 's1', ids: ['ab'] }));
    expect(sketch()?.profiles).toHaveLength(0);
    unwrap(await session.execute({ type: 'toggle-construction', sketchId: 's1', ids: ['ab'] }));
    expect(sketch()?.profiles).toHaveLength(1);
  });

  it('renames and deletes timeline items', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'rename-item', itemId: 's1', name: 'Base plate' }));
    expect(session.state().document.timeline[0]?.name).toBe('Base plate');
    unwrap(await session.execute({ type: 'delete-item', itemId: 's1' }));
    expect(session.state().sketches.size).toBe(0);
  });

  it('exports a sketch as a laser-ready drawing', async () => {
    await drawRectangle();
    unwrap(await session.exportSketch('s1', 'svg'));
    expect(files.delivered[0]).toMatchObject({ name: 'Component 1 - Sketch 1.svg', mediaType: 'image/svg+xml' });
    unwrap(await session.exportSketch('s1', 'dxf'));
    expect(new TextDecoder().decode(files.delivered[1]?.bytes)).toContain('ENTITIES');
  });

  it('notifies subscribers of every change', async () => {
    const seen: number[] = [];
    session.subscribe((state) => seen.push(state.document.timeline.length));
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    await session.undo();
    expect(seen).toEqual([1, 0]);
  });

  describe('part modeling', () => {
    /** The rectangle, anchored at the origin and dimensioned with parameters. */
    async function plate(): Promise<string> {
      await drawRectangle();
      unwrap(await session.execute({ type: 'add-parameter', parameter: { id: 'pw', name: 'width', expression: '60 mm' } }));
      unwrap(await session.execute({ type: 'add-parameter', parameter: { id: 'pt', name: 'thickness', expression: 'width / 10' } }));
      unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'o', kind: 'coincident', points: ['a', sketchOriginId] } }));
      unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'distance', points: ['a', 'b'], expression: 'width' } }));
      unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'h', kind: 'distance', points: ['b', 'c'], expression: '30' } }));
      const profile = session.state().sketches.get('s1')?.profiles[0]?.id as string;
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'e1', type: 'extrude', name: '', suppressed: false, sketch: 's1', profiles: [profile], distance: 'thickness', direction: 'normal', operation: 'new-body' } }));
      return profile;
    }
    const volume = async () => Object.values(await session.volumes()).reduce((a, b) => a + b, 0);

    it('extrudes a sketch profile into a body driven by parameters', async () => {
      await plate();
      expect(session.state().document.timeline.map((i) => i.name)).toEqual(['Sketch 1', 'Extrude 1']);
      expect(session.state().items.get('e1')).toEqual({ state: 'ok' });
      expect(session.state().bodies).toHaveLength(1);
      expect(await volume()).toBeCloseTo(60 * 30 * 6);
      expect(session.state().parameters.map((p) => p.display)).toEqual(['60 mm', '6 mm']);

      unwrap(await session.execute({ type: 'set-parameter', parameter: { id: 'pw', name: 'width', expression: '80 mm' } }));
      expect(await volume()).toBeCloseTo(80 * 30 * 8);
    });

    it('refuses parameter changes that would break the model', async () => {
      await plate();
      const broken = await session.execute({ type: 'delete-parameter', id: 'pt' });
      expect(broken).toMatchObject({ ok: false, error: { code: 'breaks-model', message: expect.stringContaining('Extrude 1 would fail') } });
      const cycle = await session.execute({ type: 'set-parameter', parameter: { id: 'pw', name: 'width', expression: 'thickness * 10' } });
      expect(cycle).toMatchObject({ ok: false, error: { code: 'cycle' } });
    });

    it('rounds edges and keeps them rounded when dimensions change', async () => {
      await plate();
      const edge = session.state().bodies[0]?.edges.find((e) => e.name.includes('f:e1:end') && e.name.includes(':side:ab'));
      expect(edge).toBeDefined();
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'r1', type: 'fillet', name: '', suppressed: false, edges: [{ kind: 'edge', body: 'e1', name: edge?.name as string }], size: '2' } }));
      const rounded = await volume();
      expect(rounded).toBeLessThan(60 * 30 * 6);
      unwrap(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'h', expression: '40' }));
      expect(session.state().items.get('r1')).toEqual({ state: 'ok' });
      expect(await volume()).toBeCloseTo(rounded + 60 * 10 * 6, 1);
    });

    it('refuses features that fail, with the kernel’s reason', async () => {
      await plate();
      const tooThick = await session.execute({ type: 'add-feature', feature: { id: 'sh', type: 'shell', name: '', suppressed: false, faces: [{ kind: 'face', body: 'e1', name: 'f:e1:end' }], thickness: '40' } });
      expect(tooThick.ok).toBe(false);
      expect(session.state().document.timeline.some((i) => i.id === 'sh')).toBe(false);
    });

    it('sketches on faces and construction planes', async () => {
      await plate();
      unwrap(await session.execute({ type: 'create-sketch', id: 's2', plane: { face: { kind: 'face', body: 'e1', name: 'f:e1:end' } } }));
      expect(session.state().sketches.get('s2')?.frame.origin[2]).toBeCloseTo(6);
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'p1', type: 'plane', name: '', suppressed: false, base: 'XY', offset: '-5' } }));
      expect(session.state().planes.get('p1')?.origin).toEqual([0, 0, -5]);
      unwrap(await session.execute({ type: 'create-sketch', id: 's3', plane: { plane: 'p1' } }));
      expect(session.state().sketches.get('s3')?.frame.origin).toEqual([0, 0, -5]);
    });

    it('suppresses features and undoes them', async () => {
      await plate();
      unwrap(await session.execute({ type: 'suppress-item', itemId: 'e1', suppressed: true }));
      expect(session.state().bodies).toHaveLength(0);
      expect(session.state().items.get('e1')).toEqual({ state: 'suppressed' });
      await session.undo();
      expect(session.state().bodies).toHaveLength(1);
    });

    it('exports the bodies as STEP', async () => {
      await plate();
      unwrap(await session.exportBodies('step'));
      const delivered = files.delivered.at(-1);
      expect(delivered?.name).toBe('Component 1.step');
      expect(new TextDecoder().decode(delivered?.bytes)).toContain("'Extrude 1'");
    });
  });
});
