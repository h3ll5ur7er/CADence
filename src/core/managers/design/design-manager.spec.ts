import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { createShapeAccess } from '@core/access/shape';
import {
  asAssetId,
  asDocumentId,
  asProjectId,
  type ComponentDocument,
  currentSchemaVersion,
  type DomainEvents,
  type ImportFormat,
  type Result,
  type SketchPoint,
  sketchOriginId,
} from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { cubeStl, plateSvg } from '@core/contracts/testing/files';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('DesignManager', () => {
  let documents: InMemoryDocumentAccess;
  let files: InMemoryExternalFileAccess;
  let assets: InMemoryAssetAccess;
  let events: EventBus<DomainEvents>;
  let session: DesignSession;
  let documentId: ComponentDocument['id'];

  beforeEach(async () => {
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
