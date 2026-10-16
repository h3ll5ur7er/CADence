import { type Sketch, type SketchPoint, sketchOriginId } from '@core/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSketchEngine, type SketchEngine, type SketchSolution } from './index';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { independentParts } from './planegcs-solver';

let engine: SketchEngine;
beforeAll(() => {
  engine = createSketchEngine();
});

const values = (entries: Record<string, number> = {}) => new Map(Object.entries(entries));

function point(solution: SketchSolution, id: string): [number, number] {
  const p = solution.sketch.entities.find((e): e is SketchPoint => e.id === id && e.kind === 'point');
  if (!p) throw new Error(`no point ${id}`);
  return [p.x, p.y];
}

/** A 40 × 20 rectangle anchored at the origin: the classic fully constrained sketch. */
function rectangle(width = 40, height = 20): { sketch: Sketch; values: Map<string, number> } {
  const b = new SketchBuilder();
  const [bottom, right, top, left] = b.polygon([1, 1], [30, 2], [31, 15], [2, 14]) as [string, string, string, string];
  b.constrain({ id: 'h1', kind: 'horizontal', line: bottom });
  b.constrain({ id: 'h2', kind: 'horizontal', line: top });
  b.constrain({ id: 'v1', kind: 'vertical', line: left });
  b.constrain({ id: 'v2', kind: 'vertical', line: right });
  b.constrain({ id: 'o', kind: 'coincident', points: ['p1', sketchOriginId] });
  b.constrain({ id: 'w', kind: 'distance', points: ['p1', 'p2'], expression: String(width) });
  b.constrain({ id: 'h', kind: 'distance', points: ['p2', 'p3'], expression: String(height) });
  return { sketch: b.build(), values: values({ w: width, h: height }) };
}

describe('SketchEngine.solve', () => {
  it('solves a fully constrained rectangle', async () => {
    const { sketch, values } = rectangle();
    const solution = await engine.solve(sketch, values);
    expect(solution.status).toBe('fully-constrained');
    expect(solution.degreesOfFreedom).toBe(0);
    expect(point(solution, 'p1')).toEqual([expect.closeTo(0), expect.closeTo(0)]);
    expect(point(solution, 'p3')).toEqual([expect.closeTo(40), expect.closeTo(20)]);
  });

  it('reports remaining degrees of freedom', async () => {
    const { sketch } = rectangle();
    const loose = { ...sketch, constraints: sketch.constraints.filter((c) => c.id !== 'w' && c.id !== 'h') };
    const solution = await engine.solve(loose, values());
    expect(solution.status).toBe('under-constrained');
    expect(solution.degreesOfFreedom).toBe(2);
  });

  it('names the conflicting constraints and leaves the geometry alone', async () => {
    const { sketch, values: v } = rectangle();
    const b = { ...sketch, constraints: [...sketch.constraints, { id: 'w2', kind: 'distance' as const, points: ['p1', 'p2'] as const, expression: '50' }] };
    const solution = await engine.solve(b, new Map([...v, ['w2', 50]]));
    expect(solution.status).toBe('over-constrained');
    expect(solution.conflicting).toEqual(expect.arrayContaining(['w', 'w2']));
    expect(point(solution, 'p3')).toEqual([31, 15]);
  });

  it('solves independent parts on their own, and hundreds of separate holes quickly', async () => {
    const { sketch, values: v } = rectangle();
    const b = new SketchBuilder();
    // Ids apart from the rectangle's (p1 …, l1 …).
    const holes = Array.from({ length: 300 }, (_, i) => {
      const centre = b.point(5 + (i % 20) * 2, 5 + Math.floor(i / 20) * 2, `hc${i}`);
      const circle = b.circle(centre, 0.4, false, `h${i}`);
      b.constrain({ id: `hx${i}`, kind: 'horizontal-distance', points: [sketchOriginId, centre], expression: String(5 + (i % 20) * 2) });
      b.constrain({ id: `hy${i}`, kind: 'vertical-distance', points: [sketchOriginId, centre], expression: String(5 + Math.floor(i / 20) * 2) });
      b.constrain({ id: `hd${i}`, kind: 'diameter', curve: circle, expression: '1' });
      return { x: 5 + (i % 20) * 2, y: 5 + Math.floor(i / 20) * 2 };
    });
    const extra = b.build();
    const both: Sketch = { ...sketch, entities: [...sketch.entities, ...extra.entities], constraints: [...sketch.constraints, ...extra.constraints] };
    expect(independentParts(both)).toHaveLength(301);
    const all = new Map([...v, ...holes.flatMap((h, i) => [[`hx${i}`, h.x], [`hy${i}`, h.y], [`hd${i}`, 1]] as [string, number][])]);
    const started = performance.now();
    const solution = await engine.solve(both, all);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(solution.status).toBe('fully-constrained');
    expect(point(solution, 'p3')).toEqual([expect.closeTo(40), expect.closeTo(20)]);
    expect(point(solution, 'hc299')).toEqual([expect.closeTo(43), expect.closeTo(33)]);
    expect(solution.sketch.entities.find((e) => e.id === 'h0')).toMatchObject({ radius: expect.closeTo(0.5) });
    // One part over-constrained: the whole sketch says so and keeps its positions.
    const clash = { ...both, constraints: [...both.constraints, { id: 'w2', kind: 'distance' as const, points: ['p1', 'p2'] as const, expression: '50' }] };
    const failed = await engine.solve(clash, new Map([...all, ['w2', 50]]));
    expect(failed.status).toBe('over-constrained');
    expect(failed.conflicting).toEqual(expect.arrayContaining(['w', 'w2']));
    expect(point(failed, 'hc0')).toEqual([5, 5]);
  });

  it('handles circles, arcs and their dimensions', async () => {
    const b = new SketchBuilder();
    const c = b.point(5, 5);
    const circle = b.circle(c, 7);
    const ac = b.point(50, 0);
    const arc = b.arc(ac, b.point(58, 0), b.point(50, 9));
    b.constrain({ id: 'cc', kind: 'coincident', points: [c, sketchOriginId] });
    b.constrain({ id: 'd', kind: 'diameter', curve: circle, expression: '30' });
    b.constrain({ id: 'r', kind: 'radius', curve: arc, expression: '12' });
    const solution = await engine.solve(b.build(), values({ d: 30, r: 12 }));
    const solved = solution.sketch.entities.find((e) => e.id === circle);
    expect(solved).toMatchObject({ radius: expect.closeTo(15) });
    const [cx, cy] = point(solution, ac);
    const [sx, sy] = point(solution, 'p4');
    expect(Math.hypot(sx - cx, sy - cy)).toBeCloseTo(12);
  });

  it('applies relations between curves', async () => {
    const b = new SketchBuilder();
    const l1 = b.line(b.point(0, 0), b.point(10, 1));
    const l2 = b.line(b.point(0, 5), b.point(9, 7));
    const l3 = b.line(b.point(20, 0), b.point(21, 9));
    const mid = b.point(4, 3);
    b.constrain({ id: 'fix', kind: 'fix', point: 'p1', x: 0, y: 0 });
    b.constrain({ id: 'h', kind: 'horizontal', line: l1 });
    b.constrain({ id: 'par', kind: 'parallel', lines: [l1, l2] });
    b.constrain({ id: 'perp', kind: 'perpendicular', lines: [l1, l3] });
    b.constrain({ id: 'eq', kind: 'equal', curves: [l1, l2] });
    b.constrain({ id: 'm', kind: 'midpoint', point: mid, line: l1 });
    b.constrain({ id: 'len', kind: 'distance', points: ['p1', 'p2'], expression: '10' });
    const solution = await engine.solve(b.build(), values({ len: 10 }));
    type P = [number, number];
    const [a, c, d, e, f, g] = ['p1', 'p2', 'p4', 'p5', 'p7', 'p8'].map((id) => point(solution, id)) as [P, P, P, P, P, P];
    expect(c[1] - a[1]).toBeCloseTo(0); // horizontal
    expect(e[1] - d[1]).toBeCloseTo(0); // parallel to a horizontal line
    expect(Math.abs(e[0] - d[0])).toBeCloseTo(10); // equal length
    expect(g[0] - f[0]).toBeCloseTo(0); // perpendicular to a horizontal line
    expect(point(solution, mid)).toEqual([expect.closeTo(5), expect.closeTo(0)]);
  });

  it('applies tangency, point-on, angle and axis distances', async () => {
    const b = new SketchBuilder();
    const center = b.point(0, 0);
    const circle = b.circle(center, 10);
    const line = b.line(b.point(-20, 12), b.point(20, 11));
    const onCircle = b.point(9, 3);
    const base = b.line(b.point(30, 0), b.point(40, 0));
    const leg = b.line(b.point(30, 0.1), b.point(35, 8));
    b.constrain({ id: 'fix', kind: 'fix', point: center, x: 0, y: 0 });
    b.constrain({ id: 'r', kind: 'radius', curve: circle, expression: '10' });
    b.constrain({ id: 'h', kind: 'horizontal', line });
    b.constrain({ id: 't', kind: 'tangent', curves: [line, circle] });
    b.constrain({ id: 'on', kind: 'point-on', point: onCircle, curve: circle });
    b.constrain({ id: 'hb', kind: 'horizontal', line: base });
    b.constrain({ id: 'join', kind: 'coincident', points: ['p7', 'p10'] });
    b.constrain({ id: 'ang', kind: 'angle', lines: [base, leg], expression: '60 deg' });
    b.constrain({ id: 'dx', kind: 'horizontal-distance', points: [center, 'p7'], expression: '30' });
    b.constrain({ id: 'dy', kind: 'vertical-distance', points: [center, 'p7'], expression: '0' });
    b.constrain({ id: 'pl', kind: 'point-line-distance', point: 'p11', line: base, expression: '8' });
    const solution = await engine.solve(b.build(), values({ r: 10, ang: Math.PI / 3, dx: 30, dy: 0, pl: 8 }));
    expect(solution.status).not.toBe('failed');
    expect(point(solution, 'p3')[1]).toBeCloseTo(10); // tangent horizontal line touches the top
    const [ox, oy] = point(solution, onCircle);
    expect(Math.hypot(ox, oy)).toBeCloseTo(10);
    expect(point(solution, 'p7')).toEqual([expect.closeTo(30), expect.closeTo(0)]);
    const [lx, ly] = point(solution, 'p11');
    expect(ly).toBeCloseTo(8);
    expect(Math.atan2(ly, lx - 30)).toBeCloseTo(Math.PI / 3);
  });

  it('drags a point as far as the constraints allow', async () => {
    const b = new SketchBuilder();
    const line = b.line(b.point(0, 0), b.point(10, 0));
    b.constrain({ id: 'fix', kind: 'fix', point: 'p1', x: 0, y: 0 });
    b.constrain({ id: 'h', kind: 'horizontal', line });
    const solution = await engine.solve(b.build(), values(), { point: 'p2', x: 25, y: 9 });
    expect(point(solution, 'p2')).toEqual([expect.closeTo(25), expect.closeTo(0)]);
  });

  it('shapes an ellipse by its points and its minor radius dimension', async () => {
    const b = new SketchBuilder();
    const center = b.point(1, 1);
    const major = b.point(18, 2);
    const ellipse = b.ellipse(center, major, 6);
    b.constrain({ id: 'c', kind: 'coincident', points: [center, sketchOriginId] });
    b.constrain({ id: 'h', kind: 'horizontal-distance', points: [center, major], expression: '20' });
    b.constrain({ id: 'v', kind: 'vertical-distance', points: [center, major], expression: '0' });
    const loose = await engine.solve(b.build(), values({ h: 20, v: 0 }));
    expect(loose.degreesOfFreedom).toBe(1); // the minor radius
    b.constrain({ id: 'r', kind: 'radius', curve: ellipse, expression: '8' });
    const solution = await engine.solve(b.build(), values({ h: 20, v: 0, r: 8 }));
    expect(solution.status).toBe('fully-constrained');
    expect(solution.sketch.entities.find((e) => e.id === ellipse)).toMatchObject({ minorRadius: 8 });
    expect(solution.profiles[0]?.area).toBeCloseTo(Math.PI * 20 * 8, 6);
  });

  it('moves a spline with its points', async () => {
    const b = new SketchBuilder();
    const points = [b.point(0, 0), b.point(10, 8), b.point(20, 0)];
    b.spline(points);
    b.constrain({ id: 'c', kind: 'coincident', points: [points[0] as string, sketchOriginId] });
    const solution = await engine.solve(b.build(), values());
    expect(solution.status).toBe('under-constrained');
    expect(solution.degreesOfFreedom).toBe(4);
  });

  it('holds the new relations: level points, symmetry, concentric curves, collinear lines', async () => {
    const b = new SketchBuilder();
    const [p, q] = [b.point(1, 2), b.point(9, 5)];
    b.constrain({ id: 'level', kind: 'horizontal-points', points: [p, q] });
    const bottom = b.point(0, -10);
    const axis = b.line(bottom, b.point(0, 10));
    b.constrain({ id: 'axis', kind: 'vertical', line: axis });
    const [m, n] = [b.point(-4, 3), b.point(5, 2)];
    b.constrain({ id: 'mirror', kind: 'symmetric', points: [m, n], line: axis });
    const c1 = b.circle(b.point(20, 20), 5);
    const c2 = b.arc(b.point(22, 19), b.point(30, 19), b.point(22, 27));
    b.constrain({ id: 'same-centre', kind: 'concentric', curves: [c1, c2] });
    const l1 = b.line(b.point(0, 30), b.point(10, 31));
    const l2 = b.line(b.point(15, 33), b.point(25, 32));
    b.constrain({ id: 'in-line', kind: 'collinear', lines: [l1, l2] });
    const solution = await engine.solve(b.build(), values());
    expect(solution.status).toBe('under-constrained');
    expect(point(solution, p)[1]).toBeCloseTo(point(solution, q)[1], 9);
    const [mx, my] = point(solution, m);
    const [nx, ny] = point(solution, n);
    const x = point(solution, bottom)[0];
    expect(mx + nx).toBeCloseTo(2 * x, 9);
    expect(my).toBeCloseTo(ny, 9);
    const centre = (id: string) => solution.sketch.entities.find((e) => e.id === id) as { center: string };
    expect(point(solution, centre(c1).center)).toEqual(point(solution, centre(c2).center).map((v) => expect.closeTo(v, 9)));
    const line = (id: string) => solution.sketch.entities.find((e) => e.id === id) as { start: string; end: string };
    const [a, d] = [point(solution, line(l1).start), point(solution, line(l1).end)];
    for (const e of [point(solution, line(l2).start), point(solution, line(l2).end)]) {
      expect((d[0] - a[0]) * (e[1] - a[1]) - (d[1] - a[1]) * (e[0] - a[0])).toBeCloseTo(0, 6);
    }
  });

  it('lays out text at its anchor as profiles: one per letter, holes included', async () => {
    const b = new SketchBuilder();
    const anchor = b.point(5, 5);
    b.text(anchor, 'HO', 10, 't');
    const solution = await engine.solve(b.build(), values());
    expect(solution.texts.get('t')).toHaveLength(3); // H, and O with its hole
    expect(solution.profiles).toHaveLength(3); // H, the ring of the O, and the region inside it (as with a hole in a plate)
    const o = solution.profiles.find((p) => p.holes.length === 1);
    expect(o?.outer.edges.every((e) => e.source === 't')).toBe(true);
    // The H sits exactly on the baseline and reaches the capital height (round letters overshoot both a little).
    const h = [...solution.profiles].sort((p, q) => Math.min(...p.outer.polygon.map((v) => v[0])) - Math.min(...q.outer.polygon.map((v) => v[0])))[0];
    const ys = h?.outer.polygon.map((q) => q[1]) ?? [];
    expect(Math.min(...ys)).toBeCloseTo(5, 1);
    expect(Math.max(...ys)).toBeCloseTo(15, 1);
  });
});

describe('SketchEngine diagnostics', () => {
  it('says which points can still move, and in which directions', async () => {
    const { sketch } = rectangle();
    // Without its width the rectangle can stretch along x: the right side slides, the left stays at the origin.
    const stretchy = { ...sketch, constraints: sketch.constraints.filter((c) => c.id !== 'w') };
    const freedom = await engine.freedom(stretchy, values({ h: 20 }));
    expect(freedom.points.map((p) => p.point).sort()).toEqual(['p2', 'p3']);
    for (const p of freedom.points) expect(p.directions).toEqual([[expect.closeTo(1, 1), expect.closeTo(0, 1)]]);
    expect(await engine.freedom(sketch, values({ w: 40, h: 20 }))).toEqual({ points: [], radii: [] });

    const b = new SketchBuilder();
    const circle = b.circle(b.point(5, 5), 3);
    const loose = await engine.freedom(b.build(), values());
    expect(loose.radii).toEqual([circle]);
    expect(loose.points[0]?.directions).toHaveLength(2);
  });

  it('suggests relations and dimensions that fully define a sketch as drawn', async () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [30, 0.5], [30.5, 15], [0, 15]);
    const sketch = b.build();
    const { constraints, degreesOfFreedom } = await engine.suggest(sketch, values(), 's');
    expect(degreesOfFreedom).toBe(0);
    expect(constraints.filter((c) => c.kind === 'horizontal' || c.kind === 'vertical')).toHaveLength(4);
    expect(constraints.every((c) => c.id.startsWith('s'))).toBe(true);
    // Applied, they solve without moving what was drawn much.
    const dimensions = new Map(constraints.flatMap((c) => ('expression' in c ? [[c.id, Number.parseFloat(c.expression)] as const] : [])));
    const solved = await engine.solve({ ...sketch, constraints: [...sketch.constraints, ...constraints] }, dimensions);
    expect(solved.status).toBe('fully-constrained');
  });
});
