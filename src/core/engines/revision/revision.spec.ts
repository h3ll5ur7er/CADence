import { describe, expect, it } from 'vitest';
import { describeChange } from '@core/contracts';
import { compareDocuments, mergeDocuments } from './index';

/** A 60 × 30 plate: a sketch with a rectangle (lines on points) and its extrusion. */
const plate = () => ({
  id: 'd1',
  projectId: 'p1',
  kind: 'component',
  name: 'Plate',
  schemaVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  modifiedAt: '2026-10-01T00:00:00.000Z',
  units: 'mm',
  rollbackIndex: 0,
  parameters: [{ id: 'p1', name: 'width', expression: '60 mm' }],
  timeline: [
    {
      id: 's1',
      type: 'sketch',
      name: 'Sketch 1',
      suppressed: false,
      plane: 'XY',
      entities: [
        { id: 'a', kind: 'point', x: 0, y: 0 },
        { id: 'b', kind: 'point', x: 60, y: 0 },
        { id: 'ab', kind: 'line', start: 'a', end: 'b' },
      ],
      constraints: [{ id: 'w', kind: 'distance', points: ['a', 'b'], expression: 'width' }],
    },
    { id: 'e1', type: 'extrude', name: 'Extrude 1', suppressed: false, sketch: 's1', profiles: ['p'], distance: '6 mm', direction: 'normal', operation: 'new-body' },
  ],
});

type Doc = ReturnType<typeof plate>;
type Item = Doc['timeline'][number];
const withTimeline = (doc: Doc, timeline: readonly unknown[]): Doc => ({ ...doc, timeline: timeline as Item[] });
const sketch = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, type: 'sketch', name, suppressed: false, plane: 'XY', entities: [], constraints: [], ...extra });
const extrude = (id: string, name: string, sketchId: string, distance = '5 mm') => ({ id, type: 'extrude', name, suppressed: false, sketch: sketchId, profiles: ['p'], distance, direction: 'normal', operation: 'cut' });

describe('compareDocuments (CAD-175)', () => {
  it('lists a new hole: its sketch elements and the cut, in words', () => {
    const before = plate();
    const [s1, e1] = before.timeline as [Item & { entities: unknown[] }, Item];
    const after = withTimeline(before, [
      { ...s1, entities: [...s1.entities, { id: 'c', kind: 'circle', center: 'a', radius: 4 }] },
      e1,
      extrude('e2', 'Hole cut', 's1', '6 mm'),
    ]);
    const changes = compareDocuments(before, after);
    expect(changes.map(describeChange)).toEqual(['Added Sketch 1: circle c', 'Added Hole cut']);
    expect(changes.map((c) => c.path)).toEqual(['timeline/s1/entities/c', 'timeline/e2']);
  });

  it('says what changed in a feature, a parameter and a field, and what moved', () => {
    const before = plate();
    const [s1, e1] = before.timeline as [Item, Item];
    const after = {
      ...withTimeline(before, [{ ...e1, distance: '8 mm' }, s1]),
      parameters: [{ id: 'p1', name: 'width', expression: '80 mm' }, { id: 'p2', name: 'depth', expression: '5' }],
      material: { name: 'PETG', density: 1.27 },
      modifiedAt: '2026-10-02T00:00:00.000Z',
    };
    const words = compareDocuments(before, after).map(describeChange);
    expect(words).toContain('Changed Parameter width: expression 60 mm → 80 mm');
    expect(words).toContain('Added Parameter depth');
    expect(words).toContain('Changed Extrude 1: distance 6 mm → 8 mm');
    expect(words.filter((w) => w.startsWith('Moved'))).toHaveLength(1);
    expect(words.some((w) => w.startsWith('Changed Material'))).toBe(true);
    // When it was saved is not a change.
    expect(words.some((w) => w.includes('modifiedAt'))).toBe(false);
  });

  it('finds nothing between equal documents whose keys are in another order', () => {
    const before = plate();
    const { timeline, ...rest } = before;
    const after = JSON.parse(JSON.stringify({ timeline, ...rest })) as Doc;
    expect(compareDocuments(before, after)).toEqual([]);
  });
});

describe('mergeDocuments (CAD-176)', () => {
  const base = plate();
  const [s1, e1] = base.timeline as [Item, Item];

  it('merges two features added in two places into one component', () => {
    const mine = withTimeline(base, [s1, e1, sketch('s2', 'Sketch 2'), extrude('e2', 'Pocket', 's2')]);
    const theirs = withTimeline(base, [s1, sketch('s3', 'Sketch 3'), extrude('e3', 'Slot', 's3'), e1]);
    const { document, conflicts } = mergeDocuments(base, mine, theirs, { time: '2026-10-21T00:00:00.000Z' });
    expect(conflicts).toEqual([]);
    expect((document['timeline'] as Item[]).map((i) => i.id)).toEqual(['s1', 's3', 'e3', 'e1', 's2', 'e2']);
    expect(document['modifiedAt']).toBe('2026-10-21T00:00:00.000Z');
    expect(document['id']).toBe('d1');
  });

  it('puts both sides’ new items after the same item ours first, each after what it follows', () => {
    const mine = withTimeline(base, [s1, e1, sketch('s2', 'Sketch 2'), extrude('e2', 'Pocket', 's2')]);
    const theirs = withTimeline(base, [s1, e1, sketch('s3', 'Sketch 3'), extrude('e3', 'Slot', 's3')]);
    const { document } = mergeDocuments(base, mine, theirs);
    expect((document['timeline'] as Item[]).map((i) => i.id)).toEqual(['s1', 'e1', 's2', 'e2', 's3', 'e3']);
  });

  it('merges a sketch both changed element by element', () => {
    const entities = (s1 as unknown as { entities: unknown[] }).entities;
    const mine = withTimeline(base, [{ ...s1, entities: [...entities, { id: 'c1', kind: 'circle', center: 'a', radius: 3 }] }, e1]);
    const theirs = withTimeline(base, [{ ...s1, name: 'Outline', entities: [...entities, { id: 'c2', kind: 'circle', center: 'b', radius: 2 }] }, e1]);
    const { document, conflicts } = mergeDocuments(base, mine, theirs);
    expect(conflicts).toEqual([]);
    const merged = (document['timeline'] as Item[])[0] as unknown as { name: string; entities: { id: string }[] };
    expect(merged.name).toBe('Outline');
    expect(merged.entities.map((e) => e.id)).toEqual(['a', 'b', 'ab', 'c1', 'c2']);
  });

  it('merges parameters by name and reports the same one changed differently', () => {
    const mine = { ...base, parameters: [{ id: 'p1', name: 'width', expression: '70 mm' }, { id: 'x', name: 'height', expression: '4' }] };
    const theirs = { ...base, parameters: [{ id: 'p1', name: 'width', expression: '80 mm' }, { id: 'y', name: 'wall', expression: '2' }] };
    const { document, conflicts } = mergeDocuments(base, mine, theirs);
    expect(conflicts).toEqual([{ path: 'parameters/width', label: 'Parameter width', mine: 'expression 70 mm', theirs: 'expression 80 mm' }]);
    // Ours stands where nothing was chosen yet.
    expect((document['parameters'] as { name: string; expression: string }[]).map((p) => `${p.name}=${p.expression}`)).toEqual(['width=70 mm', 'height=4', 'wall=2']);
    const chosen = mergeDocuments(base, mine, theirs, { resolutions: { 'parameters/width': 'theirs' } });
    expect(chosen.conflicts).toEqual([]);
    expect((chosen.document['parameters'] as { expression: string }[])[0]?.expression).toBe('80 mm');
  });

  it('reports a feature changed on both sides, and one changed here but deleted there, per item', () => {
    const mine = withTimeline(base, [s1, { ...e1, distance: '8 mm' }]);
    const theirs = withTimeline(base, [s1, { ...e1, distance: '10 mm' }]);
    expect(mergeDocuments(base, mine, theirs).conflicts).toEqual([{ path: 'timeline/e1', label: 'Extrude 1', mine: 'distance 8 mm', theirs: 'distance 10 mm' }]);
    const deleted = withTimeline(base, [s1]);
    expect(mergeDocuments(base, mine, deleted).conflicts).toEqual([{ path: 'timeline/e1', label: 'Extrude 1', mine: 'distance 8 mm', theirs: 'deleted' }]);
    const taken = mergeDocuments(base, mine, deleted, { resolutions: { 'timeline/e1': 'theirs' } });
    expect((taken.document['timeline'] as Item[]).map((i) => i.id)).toEqual(['s1']);
  });

  it('drops relations and curves left on points the other side deleted', () => {
    const entities = (s1 as unknown as { entities: { id: string }[] }).entities;
    const mine = withTimeline(base, [{ ...s1, entities: entities.filter((e) => e.id === 'a'), constraints: [] }, e1]);
    const theirs = withTimeline(base, [{ ...s1, entities: [...entities, { id: 'bc', kind: 'line', start: 'b', end: 'a' }], constraints: [...(s1 as unknown as { constraints: unknown[] }).constraints, { id: 'h', kind: 'horizontal', line: 'bc' }] }, e1]);
    const merged = (mergeDocuments(base, mine, theirs).document['timeline'] as Item[])[0] as unknown as { entities: { id: string }[]; constraints: unknown[] };
    expect(merged.entities.map((e) => e.id)).toEqual(['a']);
    expect(merged.constraints).toEqual([]);
  });

  it('merges a project’s settings: its name and its parameters by name', () => {
    const settings = { name: 'Box', parameters: [{ id: '1', name: 'wall', expression: '2' }] };
    const { document, conflicts } = mergeDocuments(
      settings,
      { ...settings, name: 'Box with lid' },
      { ...settings, parameters: [...settings.parameters, { id: '2', name: 'lid', expression: '3' }] },
    );
    expect(conflicts).toEqual([]);
    expect(document).toEqual({ name: 'Box with lid', parameters: [...settings.parameters, { id: '2', name: 'lid', expression: '3' }] });
  });
});
