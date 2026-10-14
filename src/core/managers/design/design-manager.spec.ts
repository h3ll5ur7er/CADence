import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
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
      interchange: createInterchangeEngine(),
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
});
