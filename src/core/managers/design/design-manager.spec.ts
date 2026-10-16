import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { createShapeAccess } from '@core/access/shape';
import {
  asAssetId,
  asDocumentId,
  asProjectId,
  type ComponentDocument,
  currentSchemaVersion,
  type DomainEvents,
  type ImportFormat,
  lengthExpression,
  type PlaneFrame,
  type PlaneRef,
  type Result,
  type SketchPoint,
  sketchOriginId,
  type Vec3,
  vertexName,
} from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { cubeStl, plateSvg } from '@core/contracts/testing/files';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { png } from '@core/utilities/picture/testing';
import { createDesignManager, type DesignSession } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Stores an imported document with its original, as the Project Manager's import does. */
async function storeImported(documents: InMemoryDocumentAccess, assets: InMemoryAssetAccess, id: string, format: ImportFormat, bytes: Uint8Array) {
  const assetId = asAssetId(`asset-${id}`);
  await assets.keep({ id: assetId, projectId: asProjectId('p1'), name: `${id}.${format}`, byteLength: bytes.length, bytes });
  await documents.store({
    id: asDocumentId(id),
    projectId: asProjectId('p1'),
    kind: 'imported',
    name: id,
    createdAt: '2026-10-14T10:00:00.000Z',
    modifiedAt: '2026-10-14T10:00:00.000Z',
    schemaVersion: currentSchemaVersion,
    assetId,
    format,
    fileName: `${id}.${format}`,
    byteLength: bytes.length,
  });
}

const sketchEngine = createSketchEngine();
const shapes = createShapeAccess();
const modeling = createModelingEngine(shapes);
const interchange = createInterchangeEngine(shapes);
const analysis = createAnalysisEngine(shapes);

const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('DesignManager', () => {
  let documents: InMemoryDocumentAccess;
  let files: InMemoryExternalFileAccess;
  let assets: InMemoryAssetAccess;
  let events: EventBus<DomainEvents>;
  let projects: InMemoryProjectAccess;
  let session: DesignSession;
  let documentId: ComponentDocument['id'];

  beforeEach(async () => {
    projects = new InMemoryProjectAccess();
    await projects.establish({ id: asProjectId('p1'), name: 'Project', createdAt: '2026-10-14T10:00:00.000Z', modifiedAt: '2026-10-14T10:00:00.000Z' });
    documents = new InMemoryDocumentAccess();
    files = new InMemoryExternalFileAccess();
    assets = new InMemoryAssetAccess();
    events = new EventBus<DomainEvents>();
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
      projects,
      documents,
      externalFiles: files,
      sketches: sketchEngine,
      parameters: createParameterEngine(),
      modeling,
      interchange,
      analysis,
      assets,
      events,
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
    expect(session.state().document.timeline.map((i) => [i.name, 'plane' in i ? i.plane : undefined])).toEqual([
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

  it('rounds a corner of a dimensioned rectangle with one undoable edit, and refuses what does not fit', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'distance', points: ['a', 'b'], expression: '40' } }));
    unwrap(await session.execute({ type: 'edit-sketch', sketchId: 's1', operation: { kind: 'fillet', point: 'c', size: 5 }, idPrefix: 'f' }));
    expect(sketch()?.sketch.entities.some((e) => e.id === 'c')).toBe(false);
    expect(sketch()?.sketch.entities.filter((e) => e.kind === 'arc')).toHaveLength(1);
    expect(sketch()?.profiles).toHaveLength(1);
    expect(sketch()?.values.get('w')).toBe(40); // dimensions on other points survive
    await session.undo();
    expect(sketch()?.sketch.entities.some((e) => e.id === 'c')).toBe(true);
    expect(await session.execute({ type: 'edit-sketch', sketchId: 's1', operation: { kind: 'fillet', point: 'c', size: 50 }, idPrefix: 'g' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-command', message: 'The radius is too large for these lines.' },
    });
  });

  it('moves and turns sketch elements, dropping the relations a turn would undo', async () => {
    await drawRectangle();
    unwrap(await session.execute({ type: 'transform-sketch-elements', sketchId: 's1', ids: ['ab', 'bc', 'cd', 'da'], translate: [10, 5] }));
    expect(pointAt('a')).toEqual([expect.closeTo(12), expect.closeTo(6)]);
    unwrap(await session.execute({ type: 'transform-sketch-elements', sketchId: 's1', ids: ['ab', 'bc', 'cd', 'da'], translate: [0, 0], rotate: { center: [12, 6], angle: Math.PI / 2 } }));
    expect(pointAt('b')).toEqual([expect.closeTo(12), expect.closeTo(34)]);
    expect(sketch()?.sketch.constraints.some((c) => c.kind === 'horizontal' || c.kind === 'vertical')).toBe(false);
    expect(await session.execute({ type: 'transform-sketch-elements', sketchId: 's1', ids: ['nope'], translate: [1, 0] })).toMatchObject({ ok: false });
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

  it('inserts an imported drawing into a sketch as one undoable change', async () => {
    await storeImported(documents, assets, 'plate', 'svg', plateSvg());
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(await session.insertDrawing('s1', asDocumentId('plate'), 'imp'));
    const view = session.state().sketches.get('s1');
    expect(view?.sketch.entities.filter((e) => e.kind === 'line' || e.kind === 'circle')).toHaveLength(5);
    expect(view?.profiles).toHaveLength(2); // the plate with its hole, and the hole
    await session.undo();
    expect(session.state().sketches.get('s1')?.sketch.entities).toHaveLength(0);
    expect(await session.insertDrawing('s1', asDocumentId('nothing'), 'x')).toMatchObject({ ok: false });
  });

  it('inserts a drawing as one piece that moves, turns and scales by its handles', async () => {
    await storeImported(documents, assets, 'plate', 'svg', plateSvg());
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(await session.insertDrawing('s1', asDocumentId('plate'), 'imp', { onePiece: true }));
    const view = () => session.state().sketches.get('s1');
    const circle = () => view()?.sketch.entities.find((e) => e.kind === 'circle');
    const point = (id: string) => view()?.sketch.entities.find((e) => e.id === id);
    expect(view()?.profiles).toHaveLength(2);
    expect(circle()).toMatchObject({ radius: expect.closeTo(4, 6) });
    expect(view()?.degreesOfFreedom).toBe(4); // only its two handles move
    // Twice as wide: everything twice its size, in proportion.
    unwrap(await session.execute({ type: 'move-point', sketchId: 's1', pointId: 'impo', x: 0, y: 0 }));
    unwrap(await session.execute({ type: 'move-point', sketchId: 's1', pointId: 'imph', x: 80, y: 0 }));
    expect(circle()).toMatchObject({ radius: expect.closeTo(8, 6) });
    const center = circle()?.kind === 'circle' ? point((circle() as { center: string }).center) : undefined;
    expect(center).toMatchObject({ x: expect.closeTo(60, 6), y: expect.closeTo(20, 6) });
    // Moving a piece of it moves the whole drawing; deleting a piece deletes it.
    const line = view()?.sketch.entities.find((e) => e.kind === 'line')?.id as string;
    unwrap(await session.execute({ type: 'transform-sketch-elements', sketchId: 's1', ids: [line], translate: [5, 0] }));
    expect(point('impo')).toMatchObject({ x: 5, y: 0 });
    expect(point('imph')).toMatchObject({ x: 85, y: 0 });
    // A dimension between the handles sizes it.
    unwrap(await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'distance', points: ['impo', 'imph'], expression: '100' } }));
    expect(circle()).toMatchObject({ radius: expect.closeTo(10, 6) });
    unwrap(await session.execute({ type: 'delete-sketch-elements', sketchId: 's1', ids: [line] }));
    expect(view()?.sketch.entities).toHaveLength(0);
  });

  it('inserts a drawing held by the relations it shows', async () => {
    await storeImported(documents, assets, 'plate', 'svg', plateSvg());
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    unwrap(await session.insertDrawing('s1', asDocumentId('plate'), 'imp', { relations: 'infer' }));
    const kinds = session.state().sketches.get('s1')?.sketch.constraints.map((c) => c.kind);
    expect(kinds?.filter((k) => k === 'horizontal')).toHaveLength(2);
    expect(kinds?.filter((k) => k === 'vertical')).toHaveLength(2);
  });

  it('notifies subscribers of every change', async () => {
    const seen: number[] = [];
    session.subscribe((state) => seen.push(state.document.timeline.length));
    unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    await session.undo();
    expect(seen).toEqual([1, 0]);
  });

  describe('sketch helpers', () => {
    it('draws curves from equations, following the parameters', async () => {
      unwrap(await session.execute({ type: 'add-parameter', parameter: { id: 'r', name: 'r', expression: '10 mm' } }));
      unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
      unwrap(
        await session.execute({
          type: 'add-sketch-geometry',
          sketchId: 's1',
          entities: [{ id: 'eq', kind: 'equation', x: 'r * cos(t)', y: 'r * sin(t)', from: '0', to: '360', samples: 73, construction: false }],
          constraints: [],
        }),
      );
      const view = session.state().sketches.get('s1');
      expect(view?.sketch.entities.filter((e) => e.id.startsWith('eq:') && e.kind === 'point')).toHaveLength(72);
      expect(view?.profiles[0]?.area).toBeCloseTo(Math.PI * 100, 0);
      unwrap(await session.execute({ type: 'set-parameter', parameter: { id: 'r', name: 'r', expression: '20 mm' } }));
      expect(session.state().sketches.get('s1')?.profiles[0]?.area).toBeCloseTo(Math.PI * 400, -1);
      // A broken expression is refused with its reason.
      const broken = await session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [{ id: 'bad', kind: 'equation', x: 'q * t', y: 't', from: '0', to: '1', samples: 5, construction: false }], constraints: [] });
      expect(broken).toMatchObject({ ok: false, error: { message: expect.stringContaining('q * t') } });
    });

    it('sets texts in imported fonts and along curves', async () => {
      await storeImported(documents, assets, 'font', 'woff', new Uint8Array(readFileSync('node_modules/@fontsource/inter/files/inter-latin-700-normal.woff')));
      unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
      unwrap(
        await session.execute({
          type: 'add-sketch-geometry',
          sketchId: 's1',
          entities: [
            { id: 'c', kind: 'point', x: 0, y: 0 },
            { id: 'ring', kind: 'circle', center: 'c', radius: 30, construction: true },
            { id: 'a', kind: 'point', x: -40, y: -50 },
            { id: 't', kind: 'text', anchor: 'a', text: 'IIII', height: 5, weight: 'regular', angle: 0, construction: false },
          ],
          constraints: [],
        }),
      );
      const width = (id: string) => {
        const points = (session.state().sketches.get('s1')?.texts.get(id) ?? []).flat().flatMap((e) => [e.start[0], e.end[0]]);
        return Math.max(...points) - Math.min(...points);
      };
      const regular = width('t');
      // In the imported (bold) font the same text runs wider.
      unwrap(await session.execute({ type: 'set-sketch-text', sketchId: 's1', textId: 't', text: 'IIII', height: 5, weight: 'regular', angle: 0, font: 'font' }));
      expect(width('t')).toBeGreaterThan(regular);
      // Along the circle (counter-clockwise) letters stand on its left: inside it, within the text height.
      const radii = async (reversed: boolean) => {
        unwrap(await session.execute({ type: 'set-sketch-text', sketchId: 's1', textId: 't', text: 'IIII', height: 5, weight: 'regular', angle: 0, along: { curve: 'ring', offset: 10, reversed } }));
        const r = (session.state().sketches.get('s1')?.texts.get('t') ?? []).flat().map((e) => Math.hypot(e.start[0], e.start[1]));
        return [Math.min(...r), Math.max(...r)];
      };
      const [innerMin, innerMax] = await radii(false);
      expect(innerMin).toBeGreaterThan(24.9);
      expect(innerMax).toBeLessThan(30.1);
      // The other side: outside it.
      const [outerMin, outerMax] = await radii(true);
      expect(outerMin).toBeGreaterThan(29.9);
      expect(outerMax).toBeLessThan(35.1);
    });

    it('traces pictures into curves', async () => {
      // A white picture with a black 96 × 48 pixel block: 25.4 × 12.7 mm at 96 pixels an inch.
      await storeImported(documents, assets, 'logo', 'png', await png(120, 80, (x, y) => x >= 10 && x < 106 && y >= 16 && y < 64));
      unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
      unwrap(await session.insertDrawing('s1', asDocumentId('logo'), 'p-', { relations: 'none', trace: { threshold: 0.5, smooth: false } }));
      const view = session.state().sketches.get('s1');
      expect(view?.profiles).toHaveLength(1);
      expect(view?.profiles[0]?.area).toBeCloseTo(25.4 * 12.7, 1);
    });

    it('names the relations a refused one conflicts with, and finds what is still free', async () => {
      unwrap(await session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
      unwrap(
        await session.execute({
          type: 'add-sketch-geometry',
          sketchId: 's1',
          entities: [
            { id: 'a', kind: 'point', x: 0, y: 0 },
            { id: 'b', kind: 'point', x: 10, y: 1 },
            { id: 'l', kind: 'line', start: 'a', end: 'b', construction: false },
          ],
          constraints: [
            { id: 'h', kind: 'horizontal', line: 'l' },
            { id: 'd', kind: 'distance', points: ['a', 'b'], expression: '10' },
          ],
        }),
      );
      // Horizontal and 10 long: its horizontal extent is 10 already.
      const refused = await session.execute({ type: 'add-constraint', sketchId: 's1', constraint: { id: 'w', kind: 'horizontal-distance', points: ['a', 'b'], expression: '5' } });
      // The solver names the existing ones that take part (the new one is not offered for removal).
      const related = refused.ok ? [] : (refused.error.related ?? []);
      expect(related.length).toBeGreaterThan(0);
      expect(related.every((id) => id === 'h' || id === 'd')).toBe(true);
      const freedom = await session.freedom('s1');
      expect(freedom.points.map((p) => p.point).sort()).toEqual(['a', 'b']);
      const suggested = await session.suggestConstraints('s1', 'x');
      unwrap(await session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [], constraints: suggested }));
      expect(session.state().sketches.get('s1')?.status).toBe('fully-constrained');
    });
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
    const volume = async () => (await session.properties()).reduce((sum, b) => sum + b.volume, 0);

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

    it('rolls the timeline back, inserts new items at the marker and rolls forward again', async () => {
      await plate();
      const fillet = (id: string) => {
        const edge = session.state().bodies[0]?.edges.find((e) => e.name.includes('f:e1:end') && e.name.includes(':side:ab'));
        return { id, type: 'fillet' as const, name: '', suppressed: false, edges: [{ kind: 'edge' as const, body: 'e1', name: edge?.name as string }], size: '2' };
      };
      unwrap(await session.execute({ type: 'add-feature', feature: fillet('r1') }));
      const rounded = await volume();
      unwrap(await session.execute({ type: 'roll-to', position: 2 }));
      expect(session.state().items.get('r1')).toEqual({ state: 'rolled-back' });
      expect(await volume()).toBeCloseTo(60 * 30 * 6);
      // A plane added now comes before the rolled-back fillet, and the marker stays after it.
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'p1', type: 'plane', name: '', suppressed: false, base: 'XY', offset: '20' } }));
      expect(session.state().document.timeline.map((i) => i.id)).toEqual(['s1', 'e1', 'p1', 'r1']);
      expect(session.state().document.rollbackIndex).toBe(1);
      unwrap(await session.execute({ type: 'roll-to', position: 4 }));
      expect(session.state().items.get('r1')).toEqual({ state: 'ok' });
      expect(await volume()).toBeCloseTo(rounded);
      // Deleting a rolled-back item keeps the marker where it is.
      unwrap(await session.execute({ type: 'roll-to', position: 3 }));
      unwrap(await session.execute({ type: 'delete-item', itemId: 'r1' }));
      expect(session.state().document.rollbackIndex).toBe(0);
    });

    it('reorders the timeline, but never before what an item uses', async () => {
      await plate();
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'p1', type: 'plane', name: '', suppressed: false, base: 'XY', offset: '20' } }));
      unwrap(await session.execute({ type: 'reorder-item', itemId: 'p1', index: 0 }));
      expect(session.state().document.timeline.map((i) => i.id)).toEqual(['p1', 's1', 'e1']);
      const early = await session.execute({ type: 'reorder-item', itemId: 'e1', index: 1 });
      expect(early).toMatchObject({ ok: false, error: { message: 'Extrude 1 uses Sketch 1, so it has to come after it.' } });
      // A sketch on a face of the extrude may not move before it either.
      unwrap(await session.execute({ type: 'create-sketch', id: 's2', plane: { face: { kind: 'face', body: 'e1', name: 'f:e1:end' } } }));
      expect(await session.execute({ type: 'reorder-item', itemId: 's2', index: 1 })).toMatchObject({ ok: false });
      await session.undo();
      expect(session.state().document.timeline.map((i) => i.id)).toEqual(['p1', 's1', 'e1']);
    });

    it('copies, splits and combines bodies with parameters', async () => {
      await plate();
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'm1', type: 'move', name: '', suppressed: false, bodies: ['e1'], translate: ['0', 'width / 2', '0'], axis: { kind: 'origin', axis: 'Z' }, angle: '0 deg', copy: true } }));
      expect(session.state().bodies.map((b) => b.body)).toEqual(['e1', 'm1']);
      expect(await volume()).toBeCloseTo(2 * 60 * 30 * 6);
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'c1', type: 'combine', name: '', suppressed: false, target: 'e1', tools: ['m1'], operation: 'join', keepTools: false } }));
      expect(session.state().bodies.map((b) => b.body)).toEqual(['e1']);
      expect(await volume()).toBeCloseTo(60 * 30 * 6 * 2);
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'p1', type: 'plane', name: '', suppressed: false, base: 'YZ', offset: '20' } }));
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'x1', type: 'split', name: '', suppressed: false, body: 'e1', plane: { plane: 'p1' } } }));
      expect(session.state().bodies.map((b) => b.body)).toEqual(['e1', 'x1']);
      expect((await session.properties()).map((p) => Math.round(p.volume))).toEqual([40 * 60 * 6, 20 * 60 * 6]);
      // The combine uses the copy, so it cannot move before the move.
      expect(await session.execute({ type: 'reorder-item', itemId: 'c1', index: 2 })).toMatchObject({ ok: false });
    });

    it('places construction planes at an angle, midway and through three points', async () => {
      await plate();
      const frame = (id: string) => session.state().planes.get(id);
      const close = (v: readonly number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'a1', type: 'plane', name: '', suppressed: false, mode: 'angle', base: 'XY', axis: { kind: 'origin', axis: 'X' }, angle: '90 deg' } }));
      const turned = frame('a1') as PlaneFrame;
      expect(close(cross3(turned.u, turned.v))).toEqual([0, -1, 0]); // XY turned up about X: the XZ plane, facing -Y
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'o1', type: 'plane', name: '', suppressed: false, base: 'XY', offset: '20' } }));
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'm1', type: 'plane', name: '', suppressed: false, mode: 'midplane', base: 'XY', second: { plane: 'o1' } } }));
      expect(close(frame('m1')?.origin ?? [])).toEqual([0, 0, 10]);
      const midTop = await session.execute({ type: 'add-feature', feature: { id: 'm2', type: 'plane', name: '', suppressed: false, mode: 'midplane', base: 'XY', second: 'XZ' } });
      expect(midTop).toMatchObject({ ok: false, error: { message: expect.stringContaining('parallel') } });
      const corner = (x: string, y: string) => ({ kind: 'vertex' as const, body: 'e1', name: vertexName([`e:f:e1:end|f:e1:side:${x}`, `e:f:e1:end|f:e1:side:${y}`, `e:f:e1:side:${[x, y].sort().join('|f:e1:side:')}`]) });
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 't1', type: 'plane', name: '', suppressed: false, mode: 'points', points: [corner('ab', 'da'), corner('ab', 'bc'), corner('bc', 'cd')] } }));
      expect(close(frame('t1')?.origin ?? [])).toEqual([0, 0, 6]);
      expect(close(cross3((frame('t1') as PlaneFrame).u, (frame('t1') as PlaneFrame).v))).toEqual([0, 0, 1]);
    });

    it('lofts between sketches, sweeps along a sketch and patterns along a path', async () => {
      /** A sketch with a w × h rectangle (or open line chain) from (x, y). */
      const sketch = async (id: string, plane: PlaneRef, points: readonly [number, number][], closed = true) => {
        unwrap(await session.execute({ type: 'create-sketch', id, plane }));
        const ids = points.map((_, i) => `${id}p${i}`);
        const lines = points.slice(0, closed ? undefined : -1).map((_, i) => ({ id: `${id}l${i}`, kind: 'line' as const, start: ids[i] as string, end: ids[(i + 1) % ids.length] as string, construction: false }));
        unwrap(await session.execute({ type: 'add-sketch-geometry', sketchId: id, entities: [...points.map(([x, y], i) => ({ id: ids[i] as string, kind: 'point' as const, x, y })), ...lines], constraints: [] }));
        return session.state().sketches.get(id)?.profiles[0]?.id as string;
      };
      const square = (x: number, y: number, w: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'top', type: 'plane', name: '', suppressed: false, base: 'XY', offset: '20' } }));
      const bottom = await sketch('s1', 'XY', square(0, 0, 20));
      const upper = await sketch('s2', { plane: 'top' }, square(5, 5, 10));
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'l1', type: 'loft', name: '', suppressed: false, sections: [{ sketch: 's1', profile: bottom }, { sketch: 's2', profile: upper }], ruled: true, operation: 'new-body' } }));
      // A ruled loft between squares is a frustum: h/3 (A1 + A2 + √(A1·A2)).
      expect(await volume()).toBeCloseTo((20 / 3) * (400 + 100 + 200), 3);

      // A 4 × 4 bar swept along an L on the XY plane at y = 50: 30 along X, then 20 along Y.
      const bar = await sketch('s3', 'YZ', square(48, 0, 4));
      await sketch('s4', 'XY', [[0, 50], [30, 50], [30, 70]], false);
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'w1', type: 'sweep', name: '', suppressed: false, sketch: 's3', profiles: [bar], path: 's4', operation: 'new-body' } }));
      expect(session.state().bodies.map((b) => b.body)).toEqual(['l1', 'w1']);

      // A 2 × 2 post on the frustum's base, repeated 3 times along the bottom edge.
      const post = await sketch('s5', 'XY', square(-1, -1, 2));
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'e9', type: 'extrude', name: '', suppressed: false, sketch: 's5', profiles: [post], distance: '5', direction: 'reverse', operation: 'new-body' } }));
      await sketch('s6', 'XY', [[0, -10], [40, -10]], false);
      const before = (await session.properties()).length;
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'pp', type: 'path-pattern', name: '', suppressed: false, features: ['e9'], path: 's6', count: '3', align: false } }));
      expect((await session.properties()).length).toBe(before + 2);
    });

    it('shows lengths in the document unit without changing the model', async () => {
      await plate();
      unwrap(await session.execute({ type: 'set-units', units: 'in' }));
      expect(session.state().document.units).toBe('in');
      expect(session.state().parameters.map((p) => p.display)).toEqual([`${Math.round((60 / 25.4) * 1000) / 1000} in`, `${Math.round((6 / 25.4) * 1000) / 1000} in`]);
      expect(await volume()).toBeCloseTo(60 * 30 * 6);
      // Typed plain numbers are inches: written out, they keep their meaning in any unit.
      expect(lengthExpression('2', 'in')).toBe('2 in');
      expect(lengthExpression('width / 2', 'in')).toBe('width / 2');
      expect(lengthExpression('5', 'mm')).toBe('5');
      unwrap(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'h', expression: lengthExpression('1', 'in') }));
      unwrap(await session.execute({ type: 'set-units', units: 'mm' }));
      expect(await volume()).toBeCloseTo(60 * 25.4 * 6);
    });

    it('uses project parameters, follows their changes, and lets its own win', async () => {
      await plate();
      /** Sets the project's parameters as the Project Manager does, and waits for the session to regenerate. */
      const setShared = async (parameters: { id: string; name: string; expression: string }[]) => {
        const updated = new Promise<void>((resolve) => {
          const stop = session.subscribe(() => {
            stop();
            resolve();
          });
        });
        const project = await projects.find(asProjectId('p1'));
        await projects.revise({ ...(project as NonNullable<typeof project>), parameters });
        events.publish('projectParametersChanged', { projectId: asProjectId('p1') });
        await updated;
      };
      const stop = session.subscribe(() => undefined);
      await setShared([{ id: 'g', name: 'gap', expression: '10 mm' }, { id: 'w', name: 'width', expression: '999 mm' }]);
      expect(session.state().parameters.filter((p) => p.project).map((p) => p.parameter.name)).toEqual(['gap']);
      unwrap(await session.execute({ type: 'set-dimension', sketchId: 's1', constraintId: 'h', expression: 'gap * 3' }));
      expect(await volume()).toBeCloseTo(60 * 30 * 6);
      await setShared([{ id: 'g', name: 'gap', expression: '5 mm' }]);
      expect(await volume()).toBeCloseTo(60 * 15 * 6);
      expect((await assets.latestResult(documentId))?.stamp).toContain('#');
      stop();
    });

    it('keeps configurations: variants it shows, exports and publishes results of', async () => {
      await plate();
      const big = { id: 'big', name: 'Big', values: { width: '80 mm' } };
      unwrap(await session.execute({ type: 'set-configurations', configurations: [big, { id: 'thin', name: 'Thin', values: { thickness: '2 mm' } }] }));
      expect(await session.execute({ type: 'set-configurations', configurations: [big, { ...big, id: 'b2' }] })).toMatchObject({ ok: false });
      unwrap(await session.execute({ type: 'activate-configuration', configuration: 'big' }));
      expect(await volume()).toBeCloseTo(80 * 30 * 8); // thickness = width / 10 follows
      unwrap(await session.execute({ type: 'activate-configuration', configuration: 'thin' }));
      expect(await volume()).toBeCloseTo(60 * 30 * 2);
      expect((await assets.latestResult(documentId, 'thin'))?.configuration).toBe('thin');
      // Another configuration exported, without changing what is shown.
      unwrap(await session.exportBodies('stl', { configuration: 'big' }));
      expect(files.delivered.at(-1)?.name).toBe('Component 1 (Big).stl');
      expect(await volume()).toBeCloseTo(60 * 30 * 2);
      unwrap(await session.execute({ type: 'activate-configuration' }));
      expect(await volume()).toBeCloseTo(60 * 30 * 6);
      // Assemblies ask for a configuration's result.
      const answered = new Promise<boolean>((resolve) => events.subscribe('componentRegenerated', ({ configuration, ok }) => resolve(configuration === 'big' && ok)));
      events.publish('regenerateComponent', { documentId, configuration: 'big' });
      expect(await answered).toBe(true);
      expect((await assets.latestResult(documentId, 'big'))?.bytes.length).toBeGreaterThan(0);
    });

    it('makes sheet metal parts: a base flange, edge flanges, and the flat pattern', async () => {
      await drawRectangle(); // 28 × 15 from (2, 1)
      const profile = session.state().sketches.get('s1')?.profiles[0]?.id as string;
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'bf', type: 'base-flange', name: '', suppressed: false, sketch: 's1', profiles: [profile], direction: 'normal', thickness: '1.5 mm', bendRadius: '1 mm', kFactor: '0.4' } }));
      expect(session.state().sheetMetal).toBe(true);
      expect(await volume()).toBeCloseTo(28 * 15 * 1.5);
      const edge = session.state().bodies[0]?.edges.find((e) => e.name.includes('f:bf:end') && e.name.includes(':side:bc'));
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'ef', type: 'edge-flange', name: '', suppressed: false, edges: [{ kind: 'edge', body: 'bf', name: edge?.name as string, hint: [30, 8.5, 1.5] }], length: '10', angle: '90 deg' } }));
      expect(await volume()).toBeGreaterThan(28 * 15 * 1.5 + 10 * 1.5 * 15);
      unwrap(await session.exportFlatPattern('dxf'));
      const file = files.delivered.at(-1);
      expect(file?.name).toBe('Component 1 - flat pattern.dxf');
      const text = new TextDecoder().decode(file?.bytes);
      expect(text).toContain('\nBEND\n');
      // The flange lies flat: the bend allowance (π/2 × (1 + 0.4 × 1.5)) and 10 mm beyond x = 30.
      const allowance = (Math.PI / 2) * (1 + 0.4 * 1.5);
      expect(text).toContain(String(Math.round((30 + allowance + 10) * 1e6) / 1e6).slice(0, 6));
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

    it('keeps how bodies look: hidden, colour and transparency, undoable; resetting removes the entry', async () => {
      await plate();
      const keys = session.state().bodies.map((b) => b.key);
      unwrap(await session.execute({ type: 'set-appearance', body: 'e1', appearance: { hidden: true, color: '#d9480f', opacity: 0.5 } }));
      expect(session.state().document.appearances).toEqual({ e1: { hidden: true, color: '#d9480f', opacity: 0.5 } });
      expect(session.state().bodies.map((b) => b.key)).toEqual(keys); // the geometry is untouched
      unwrap(await session.execute({ type: 'set-appearance', body: 'e1', appearance: {} }));
      expect(session.state().document.appearances).toEqual({});
      await session.undo();
      expect(session.state().document.appearances?.['e1']?.hidden).toBe(true);
      for (const appearance of [{ color: 'red' }, { opacity: 0 }, { opacity: 1.5 }]) {
        expect(await session.execute({ type: 'set-appearance', body: 'e1', appearance })).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
      }
      expect(await session.execute({ type: 'set-appearance', body: 'nope', appearance: { hidden: true } })).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
    });

    it('projects the edges of a face into a sketch, follows the body, and goes as one', async () => {
      await plate();
      unwrap(await session.execute({ type: 'create-sketch', id: 's2', plane: { face: { kind: 'face', body: 'e1', name: 'f:e1:end' } } }));
      const top = { kind: 'face' as const, body: 'e1', name: 'f:e1:end' };
      unwrap(await session.execute({ type: 'add-sketch-geometry', sketchId: 's2', entities: [{ id: 'pr', kind: 'projection', refs: [top], construction: false }], constraints: [] }));
      const projected = () => session.state().sketches.get('s2');
      expect(projected()?.sketch.entities.filter((e) => e.kind === 'line')).toHaveLength(4);
      expect(projected()?.status).toBe('fully-constrained'); // projected points cannot move
      expect(projected()?.profiles[0]?.area).toBeCloseTo(60 * 30, 6);
      unwrap(await session.execute({ type: 'set-parameter', parameter: { id: 'pw', name: 'width', expression: '80 mm' } }));
      expect(projected()?.profiles[0]?.area).toBeCloseTo(80 * 30, 6);
      const line = projected()?.sketch.entities.find((e) => e.kind === 'line')?.id as string;
      unwrap(await session.execute({ type: 'toggle-construction', sketchId: 's2', ids: [line] }));
      expect(projected()?.sketch.entities.filter((e) => e.kind === 'line').every((e) => e.kind === 'line' && e.construction)).toBe(true);
      unwrap(await session.execute({ type: 'delete-sketch-elements', sketchId: 's2', ids: [line] }));
      expect(projected()?.sketch.entities).toEqual([]);
    });

    it('measures picked faces and weighs bodies in the chosen material', async () => {
      await plate();
      const between = unwrap(await session.measure([{ kind: 'face', body: 'e1', name: 'f:e1:end' }, { kind: 'face', body: 'e1', name: 'f:e1:start' }]));
      expect(between).toMatchObject({ distance: 6, angle: 0, area: 2 * 60 * 30 });
      const [pla] = await session.properties();
      expect(pla?.mass).toBeCloseTo((60 * 30 * 6 * 1.24) / 1000);
      unwrap(await session.execute({ type: 'set-material', material: { name: 'Steel', density: 7.85 } }));
      expect(session.state().document.material).toEqual({ name: 'Steel', density: 7.85 });
      expect((await session.properties())[0]?.mass).toBeCloseTo((60 * 30 * 6 * 7.85) / 1000);
      await session.undo();
      expect((await session.properties())[0]?.mass).toBeCloseTo((60 * 30 * 6 * 1.24) / 1000);
      expect(await session.execute({ type: 'set-material', material: { name: 'Air', density: 0 } })).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
    });

    it('validates against the manufacturing profile', async () => {
      await plate();
      const printing = await session.validate();
      expect(printing.profile.kind).toBe('print');
      expect(printing.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass']);
      unwrap(await session.execute({ type: 'set-process', process: { kind: 'laser', name: 'Laser', bed: [400, 400], kerf: 0.2, thickness: 3 } }));
      const cutting = await session.validate();
      expect(cutting.checks.map((c) => [c.id, c.status])).toEqual([
        ['sheet', 'warning'],
        ['outlines', 'pass'],
        ['bed', 'pass'],
        ['kerf', 'pass'],
      ]);
      const invalid = await session.execute({ type: 'set-process', process: { kind: 'laser', name: 'Laser', bed: [400, 400], kerf: -1, thickness: 3 } });
      expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid-command' } });
    });

    it('exports kerf-compensated drawings for laser cutters only', async () => {
      await plate();
      expect(await session.exportSketch('s1', 'dxf', { compensateKerf: true })).toMatchObject({ ok: false, error: { code: 'not-laser' } });
      unwrap(await session.execute({ type: 'set-process', process: { kind: 'laser', name: 'Laser', bed: [400, 400], kerf: 0.2, thickness: 3 } }));
      unwrap(await session.exportSketch('s1', 'dxf', { compensateKerf: true }));
      const delivered = files.delivered.at(-1);
      expect(delivered?.name).toBe('Component 1 - Sketch 1 (kerf compensated).dxf');
      expect(new TextDecoder().decode(delivered?.bytes).split('\n')).toContain('60.1'); // the 60 mm side moved out by half the kerf
    });

    it('publishes its result for assemblies after every change', async () => {
      await plate();
      const result = await assets.latestResult(documentId);
      expect(result?.stamp).toBe(session.state().document.modifiedAt);
      const bodies = (JSON.parse(new TextDecoder().decode(result?.bytes)) as { bodies: { id: string }[] }).bodies;
      expect(bodies.map((b) => b.id)).toEqual(['e1']);
      await session.undo();
      expect((await assets.latestResult(documentId))?.stamp).toBe(session.state().document.modifiedAt);
    });

    it('answers regeneration requests with a fresh result', async () => {
      await plate();
      await assets.discardResult(documentId);
      const answers: unknown[] = [];
      events.subscribe('componentRegenerated', (answer) => void answers.push(answer));
      events.publish('regenerateComponent', { documentId });
      events.publish('regenerateComponent', { documentId: 'missing' as typeof documentId });
      await events.drained();
      await events.drained();
      expect(answers).toEqual([
        { documentId, ok: true },
        { documentId: 'missing', ok: false },
      ]);
      expect((await assets.latestResult(documentId))?.stamp).toBe(session.state().document.modifiedAt);
    });

    it('inserts the solid of an imported mesh as a body with named faces', async () => {
      await storeImported(documents, assets, 'cube', 'stl', cubeStl(10));
      unwrap(await session.execute({ type: 'add-feature', feature: { id: 'i1', type: 'insert', name: '', suppressed: false, document: 'cube' } }));
      expect(session.state().document.timeline.map((i) => i.name)).toEqual(['Insert body 1']);
      expect(await volume()).toBeCloseTo(1000, 6);
      const faces = session.state().bodies[0]?.faces.map((f) => f.name) ?? [];
      expect(faces).toHaveLength(6);
      expect(faces.every((name) => name.startsWith('f:i1:new:'))).toBe(true);
      // Its faces carry sketches like any other body's.
      const top = session.state().bodies[0]?.faces.find((f) => Math.abs((f.center[2] as number) - 10) < 1e-6)?.name as string;
      unwrap(await session.execute({ type: 'create-sketch', id: 's9', plane: { face: { kind: 'face', body: 'i1', name: top } } }));
      expect(session.state().sketches.get('s9')?.frame.origin[2]).toBeCloseTo(10);
    });

    it('fails an insert whose imported file is gone', async () => {
      const result = await session.execute({ type: 'add-feature', feature: { id: 'i1', type: 'insert', name: '', suppressed: false, document: 'nothing' } });
      expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('deleted or is not a 3D file') } });
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
