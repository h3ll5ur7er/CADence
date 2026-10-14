import { type Sketch, type SketchPoint, sketchOriginId } from '@core/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSketchEngine, type SketchEngine, type SketchSolution } from './index';
import { SketchBuilder } from './testing/sketch-builder';

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
    const [a, c, d, e, f, g] = ['p1', 'p2', 'p4', 'p5', 'p7', 'p8'].map((id) => point(solution, id)) as [number, number][];
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
});
