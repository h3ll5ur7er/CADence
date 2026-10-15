import { type Sketch, type SketchEntity, type SketchPoint, sketchOriginId } from '@core/contracts';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { describe, expect, it } from 'vitest';
import { chamfer, type EditResult, extend, fillet, offset, split, trim } from './editing';
import { findProfiles } from './profiles';

/** Applies an edit the way the Design Manager does: updates, removals (with orphaned points), additions. */
function applied(sketch: Sketch, result: EditResult): Sketch {
  if (!result.ok) throw new Error(result.reason);
  const { edit } = result;
  let entities = sketch.entities.map((e) => edit.update.find((u) => u.id === e.id) ?? e).filter((e) => !edit.remove.includes(e.id));
  const used = new Set(JSON.stringify([...entities.filter((e) => e.kind !== 'point'), ...edit.add]).match(/"[^"]+"/g)?.map((s) => s.slice(1, -1)));
  entities = entities.filter((e) => e.kind !== 'point' || used.has(e.id));
  const kept = new Set(entities.map((e) => e.id));
  return { ...sketch, entities: [...entities, ...edit.add], constraints: [...sketch.constraints.filter((c) => !JSON.stringify(c).match(/"(p\d+|l\d+)"/g)?.some((r) => !kept.has(r.slice(1, -1)) && r.slice(1, -1) !== sketchOriginId)), ...edit.constraints] };
}
const at = (s: Sketch, id: string) => {
  const p = s.entities.find((e): e is SketchPoint => e.id === id && e.kind === 'point');
  return p ? [Math.round(p.x * 1e6) / 1e6 + 0, Math.round(p.y * 1e6) / 1e6 + 0] : undefined;
};
const curves = (s: Sketch) => s.entities.filter((e) => e.kind !== 'point');
const lineEnds = (s: Sketch, e: SketchEntity | undefined) => (e?.kind === 'line' ? [at(s, e.start), at(s, e.end)] : undefined);

/** A horizontal line from (0, 0) to (30, 0), crossed by vertical lines at x = 10 and x = 20. */
function crossed() {
  const b = new SketchBuilder();
  const line = b.line(b.point(0, 0), b.point(30, 0));
  b.line(b.point(10, -5), b.point(10, 5));
  b.line(b.point(20, -5), b.point(20, 5));
  return { sketch: b.build(), line };
}

describe('sketch editing', () => {
  it('trims an end piece back to the crossing, holding the new end on the crossing line', () => {
    const { sketch, line } = crossed();
    const result = applied(sketch, trim(sketch, line, [2, 0], 'n'));
    expect(lineEnds(result, result.entities.find((e) => e.id === line))).toEqual([[10, 0], [30, 0]]);
    expect(result.constraints).toContainEqual({ id: expect.any(String), kind: 'point-on', point: expect.any(String), curve: 'l6' });
    expect(result.entities.some((e) => e.id === 'p1')).toBe(false); // the old end is gone
  });

  it('trims a middle piece by splitting the curve in two, kept in line', () => {
    const { sketch, line } = crossed();
    const result = applied(sketch, trim(sketch, line, [15, 0], 'n'));
    const pieces = result.entities.filter((e) => e.kind === 'line' && lineEnds(result, e)?.every((p) => p?.[1] === 0));
    expect(pieces.map((e) => lineEnds(result, e))).toEqual([[[0, 0], [10, 0]], [[20, 0], [30, 0]]]);
    expect(result.constraints.some((c) => c.kind === 'collinear')).toBe(true);
  });

  it('removes a curve that crosses nothing', () => {
    const b = new SketchBuilder();
    const line = b.line(b.point(0, 0), b.point(30, 0));
    const sketch = b.build();
    expect(applied(sketch, trim(sketch, line, [5, 0], 'n')).entities).toHaveLength(0);
  });

  it('turns a trimmed circle into the arc that is left', () => {
    const b = new SketchBuilder();
    const circle = b.circle(b.point(0, 0), 10);
    b.line(b.point(-20, 0), b.point(20, 0));
    const sketch = b.build();
    const result = applied(sketch, trim(sketch, circle, [0, 10], 'n'));
    const arc = result.entities.find((e) => e.id === circle);
    expect(arc?.kind).toBe('arc');
    // The upper half is gone: the arc runs counter-clockwise from (-10, 0) through the bottom to (10, 0).
    expect(arc?.kind === 'arc' && [at(result, arc.start), at(result, arc.end)]).toEqual([[-10, 0], [10, 0]]);
    expect(trim(sketch, circle, [0, 10], 'n').ok).toBe(true);
  });

  it('extends a line to the next curve it would meet', () => {
    const b = new SketchBuilder();
    const line = b.line(b.point(0, 0), b.point(5, 0));
    b.line(b.point(12, -5), b.point(12, 5));
    const sketch = b.build();
    const result = applied(sketch, extend(sketch, line, [4, 0], 'n'));
    expect(lineEnds(result, result.entities.find((e) => e.id === line))).toEqual([[0, 0], [12, 0]]);
    expect(extend(sketch, line, [1, 0], 'n')).toMatchObject({ ok: false });
  });

  it('splits a line where it is clicked', () => {
    const { sketch, line } = crossed();
    const result = applied(sketch, split(sketch, line, [25, 0.3], 'n'));
    expect(curves(result).filter((e) => e.kind === 'line')).toHaveLength(4);
    expect(lineEnds(result, result.entities.find((e) => e.id === line))).toEqual([[0, 0], [25, 0]]);
  });

  it('rounds and cuts corners of a rectangle', async () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
    const sketch = b.build();
    const rounded = applied(sketch, fillet(sketch, 'p3', 5, 'f'));
    const [profile] = findProfiles(rounded);
    expect(profile?.area).toBeCloseTo(800 - (4 - Math.PI) * 25 / 4 * 1, 6);
    expect(rounded.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(2);
    const cut = applied(sketch, chamfer(sketch, 'p3', 4, 'c'));
    expect(findProfiles(cut)[0]?.area).toBeCloseTo(800 - 8, 6);
    expect(fillet(sketch, 'p3', 30, 'f')).toMatchObject({ ok: false });
  });

  it('offsets a closed chain outward and an open one to its side', () => {
    const b = new SketchBuilder();
    const sides = b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
    const sketch = b.build();
    const grown = applied(sketch, offset(sketch, sides, 2, 'o'));
    const areas = findProfiles(grown).map((p) => p.area).sort((x, y) => x - y);
    expect(areas).toEqual([expect.closeTo(44 * 24 - 800, 6), expect.closeTo(800, 6)]); // the ring around it, and the original
    expect(grown.constraints.filter((c) => c.kind === 'parallel')).toHaveLength(4);

    const open = new SketchBuilder();
    const corner = open.point(10, 0);
    const legs = [open.line(open.point(0, 0), corner), open.line(corner, open.point(10, 10))];
    const chain = open.build();
    const moved = applied(chain, offset(chain, legs, 1, 'o'));
    const added = moved.entities.filter((e) => e.kind === 'line' && e.id.startsWith('o'));
    expect(added.map((e) => lineEnds(moved, e))).toEqual([[[0, -1], [11, -1]], [[11, -1], [11, 10]]]);
  });

  it('offsets a circle by changing its radius', () => {
    const b = new SketchBuilder();
    const circle = b.circle(b.point(0, 0), 10);
    const sketch = b.build();
    const result = applied(sketch, offset(sketch, [circle], -3, 'o'));
    expect(result.entities.find((e) => e.id !== circle && e.kind === 'circle')).toMatchObject({ radius: 7 });
  });
});
