import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { createSketchEngine } from './index';
import { inferRelations } from './relations';

/** A 30 × 10 slot: two straight sides and two half-circle ends, sharing their corner points. */
function slot() {
  const b = new SketchBuilder();
  const [p1, p2, p3, p4] = [b.point(0, 0), b.point(30, 0), b.point(30, 10), b.point(0, 10)];
  const [c1, c2] = [b.point(30, 5), b.point(0, 5)];
  const bottom = b.line(p1, p2);
  const right = b.arc(c1, p2, p3);
  const top = b.line(p3, p4);
  const left = b.arc(c2, p4, p1);
  // A slanted line touching nothing.
  b.line(b.point(40, 0), b.point(45, 7));
  return { sketch: b.build(), bottom, right, top, left };
}

describe('relations of imported geometry', () => {
  it('infers horizontal and vertical lines and tangent joints', () => {
    const { sketch, bottom, right, top, left } = slot();
    const relations = inferRelations(sketch.entities, 'infer', 'i-');
    expect(relations.filter((r) => r.kind === 'horizontal').map((r) => r.kind === 'horizontal' && r.line)).toEqual([bottom, top]);
    expect(relations.some((r) => r.kind === 'vertical')).toBe(false);
    const tangents = relations.flatMap((r) => (r.kind === 'tangent' ? [r.curves] : []));
    expect(tangents).toHaveLength(4);
    expect(tangents).toContainEqual([bottom, right]);
    expect(tangents).toContainEqual([top, left]);
    expect(new Set(relations.map((r) => r.id)).size).toBe(relations.length);
    expect(relations.every((r) => r.id.startsWith('i-'))).toBe(true);
  });

  it('leaves the inferred slot solvable, not over-constrained', async () => {
    const { sketch } = slot();
    const solution = await createSketchEngine().solve({ ...sketch, constraints: inferRelations(sketch.entities, 'infer', 'i-') }, new Map());
    expect(solution.status).toBe('under-constrained');
  });

  it('fixes every point, or adds nothing', async () => {
    const { sketch } = slot();
    const fixed = inferRelations(sketch.entities, 'fix', 'f-');
    expect(fixed).toHaveLength(sketch.entities.filter((e) => e.kind === 'point').length);
    expect(fixed[0]).toMatchObject({ kind: 'fix', x: 0, y: 0 });
    expect((await createSketchEngine().solve({ ...sketch, constraints: fixed }, new Map())).status).toBe('fully-constrained');
    expect(inferRelations(sketch.entities, 'none', 'n-')).toEqual([]);
  });

  it('fixes arcs that meet end to end without pinning them twice', async () => {
    // An S: two half circles that both end in the middle point.
    const b = new SketchBuilder();
    const [a, m, z] = [b.point(0, 0), b.point(10, 0), b.point(20, 0)];
    b.arc(b.point(5, 0), a, m);
    b.arc(b.point(15, 0), z, m);
    const sketch = b.build();
    const solution = await createSketchEngine().solve({ ...sketch, constraints: inferRelations(sketch.entities, 'fix', 'f-') }, new Map());
    expect(solution.status).toBe('fully-constrained');
  });
});
