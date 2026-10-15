import { describe, expect, it } from 'vitest';
import { type Bezier, closestParameter, curveArea, curveAt, curveDerivative, ellipseOf, sampleCurve, splineBeziers, splitBezier } from './curves';
import { signedArea } from './index';

const close = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i] as number, digits));
const direction = (v: readonly [number, number]) => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};

describe('curves', () => {
  it('runs a spline through every point, smoothly', () => {
    const points = [[0, 0], [10, 5], [20, 0], [30, 8]] as const;
    const beziers = splineBeziers(points, false);
    expect(beziers).toHaveLength(3);
    beziers.forEach((b, i) => {
      close(b[0], points[i] as readonly number[]);
      close(b[3], points[i + 1] as readonly number[]);
    });
    for (let i = 0; i + 1 < beziers.length; i++) {
      const out = curveDerivative({ kind: 'bezier', points: beziers[i] as Bezier }, 1);
      const into = curveDerivative({ kind: 'bezier', points: beziers[i + 1] as Bezier }, 0);
      close(direction(out), direction(into));
    }
  });

  it('makes two points a straight piece and closes a closed spline', () => {
    const [line] = splineBeziers([[0, 0], [12, 0]], false);
    close(curveAt({ kind: 'bezier', points: line as Bezier }, 0.5), [6, 0]);
    const loop = splineBeziers([[0, 0], [10, 0], [10, 10], [0, 10]], true);
    expect(loop).toHaveLength(4);
    close((loop[3] as Bezier)[3], [0, 0]);
  });

  it('splits a Bézier into the exact piece between two parameters', () => {
    const b: Bezier = [[0, 0], [3, 9], [8, -4], [12, 2]];
    const piece = splitBezier(b, 0.25, 0.75);
    for (const s of [0, 0.3, 0.5, 1]) close(curveAt({ kind: 'bezier', points: piece }, s), curveAt({ kind: 'bezier', points: b }, 0.25 + s * 0.5));
  });

  it('measures the area under curves exactly', () => {
    const e = ellipseOf([2, 3], [12, 3], 4);
    expect(curveArea({ kind: 'ellipse', ellipse: e }, 0, 2 * Math.PI)).toBeCloseTo(Math.PI * 10 * 4, 9);
    const b: Bezier = [[0, 0], [3, 9], [8, -4], [12, 2]];
    const curve = { kind: 'bezier' as const, points: b };
    // Closed by the chord back to the start: the curve's area term plus the chord's.
    const polygon = signedArea(sampleCurve(curve, 0, 1, 1e-6));
    expect(curveArea(curve, 0, 1) + (b[3][0] * b[0][1] - b[0][0] * b[3][1]) / 2).toBeCloseTo(polygon, 4);
  });

  it('places ellipses by their centre, major axis end and minor radius', () => {
    const e = ellipseOf([0, 0], [0, 10], 4);
    const curve = { kind: 'ellipse' as const, ellipse: e };
    close(curveAt(curve, 0), [0, 10]);
    close(curveAt(curve, Math.PI / 2), [-4, 0]);
  });

  it('finds the parameter of the nearest point', () => {
    const curve = { kind: 'ellipse' as const, ellipse: ellipseOf([0, 0], [10, 0], 5) };
    const nearest = closestParameter(curve, [0, 9], 0, 2 * Math.PI);
    expect(nearest.t).toBeCloseTo(Math.PI / 2, 6);
    expect(nearest.distance).toBeCloseTo(4, 6);
  });

  it('samples within the tolerance, ends included', () => {
    const curve = { kind: 'ellipse' as const, ellipse: ellipseOf([0, 0], [10, 0], 5) };
    const points = sampleCurve(curve, 0, Math.PI, 0.01);
    close(points[0] as readonly number[], [10, 0]);
    close(points.at(-1) as readonly number[], [-10, 0]);
    expect(points.length).toBeGreaterThan(10);
  });
});
