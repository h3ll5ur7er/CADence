import { type Vec2 } from './index';

/**
 * Free-form sketch curves: cubic Béziers (the pieces of splines) and ellipses, as parametric curves.
 * One definition serves the solver's profiles, the kernel, drawing export and the display.
 */

/** Start, two control points, end. */
export type Bezier = readonly [Vec2, Vec2, Vec2, Vec2];

/** Semi-axes `a` along `rotation` and `b` across it. */
export interface Ellipse {
  readonly center: Vec2;
  readonly a: number;
  readonly b: number;
  readonly rotation: number;
}

/** A Bézier runs over t ∈ [0, 1]; an ellipse over t ∈ [0, 2π), counter-clockwise from its major axis. */
export type ParamCurve = { readonly kind: 'bezier'; readonly points: Bezier } | { readonly kind: 'ellipse'; readonly ellipse: Ellipse };

/** An ellipse from its centre, the end of its major axis and its minor radius. */
export function ellipseOf(center: Vec2, major: Vec2, minorRadius: number): Ellipse {
  return { center, a: Math.hypot(major[0] - center[0], major[1] - center[1]), b: minorRadius, rotation: Math.atan2(major[1] - center[1], major[0] - center[0]) };
}

/** The parameter t of a point on (or near) an ellipse, in [0, 2π). */
export function ellipseParameter(e: Ellipse, p: Vec2): number {
  const dx = p[0] - e.center[0];
  const dy = p[1] - e.center[1];
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const t = Math.atan2((-dx * sin + dy * cos) / e.b, (dx * cos + dy * sin) / e.a);
  return t < 0 ? t + 2 * Math.PI : t;
}

const bernstein = (b: Bezier, t: number, axis: 0 | 1) => {
  const s = 1 - t;
  return s * s * s * b[0][axis] + 3 * s * s * t * b[1][axis] + 3 * s * t * t * b[2][axis] + t * t * t * b[3][axis];
};

/** In the ellipse's own frame, then rotated and moved. */
const placed = (e: Ellipse, x: number, y: number, moved: boolean): Vec2 => {
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  return [x * cos - y * sin + (moved ? e.center[0] : 0), x * sin + y * cos + (moved ? e.center[1] : 0)];
};

export function curveAt(curve: ParamCurve, t: number): Vec2 {
  if (curve.kind === 'bezier') return [bernstein(curve.points, t, 0), bernstein(curve.points, t, 1)];
  const e = curve.ellipse;
  return placed(e, e.a * Math.cos(t), e.b * Math.sin(t), true);
}

export function curveDerivative(curve: ParamCurve, t: number): Vec2 {
  if (curve.kind === 'ellipse') {
    const e = curve.ellipse;
    return placed(e, -e.a * Math.sin(t), e.b * Math.cos(t), false);
  }
  const [p0, p1, p2, p3] = curve.points;
  const s = 1 - t;
  const d = (axis: 0 | 1) => 3 * s * s * (p1[axis] - p0[axis]) + 6 * s * t * (p2[axis] - p1[axis]) + 3 * t * t * (p3[axis] - p2[axis]);
  return [d(0), d(1)];
}

export function curveSecondDerivative(curve: ParamCurve, t: number): Vec2 {
  if (curve.kind === 'ellipse') {
    const e = curve.ellipse;
    return placed(e, -e.a * Math.cos(t), -e.b * Math.sin(t), false);
  }
  const [p0, p1, p2, p3] = curve.points;
  const d = (axis: 0 | 1) => 6 * (1 - t) * (p2[axis] - 2 * p1[axis] + p0[axis]) + 6 * t * (p3[axis] - 2 * p2[axis] + p1[axis]);
  return [d(0), d(1)];
}

/** The exact piece of a Bézier between two parameters (de Casteljau). */
export function splitBezier(b: Bezier, t0: number, t1: number): Bezier {
  const head = (c: Bezier, t: number): Bezier => {
    const mix = (p: Vec2, q: Vec2): Vec2 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const a = mix(c[0], c[1]);
    const m = mix(c[1], c[2]);
    const d = mix(c[2], c[3]);
    const e = mix(a, m);
    const f = mix(m, d);
    return [c[0], a, e, mix(e, f)];
  };
  const reversed = (c: Bezier): Bezier => [c[3], c[2], c[1], c[0]];
  // Keep [0, t1], then of that keep the part after t0 (re-scaled), by cutting the reversed curve.
  const upTo = t1 >= 1 ? b : head(b, t1);
  const from = t1 > 0 ? t0 / t1 : 0;
  return from <= 0 ? upTo : reversed(head(reversed(upTo), 1 - from));
}

/**
 * A smooth spline through the points, as one cubic Bézier per gap. Each point's tangent points from
 * its previous to its next neighbour (tangent continuous, no overshoot on uneven spacing); the ends
 * of an open spline mirror their neighbour's tangent. Handles are a third of the gap long.
 */
export function splineBeziers(points: readonly Vec2[], closed: boolean): Bezier[] {
  const n = points.length;
  if (n < 2) return [];
  const at = (i: number) => points[((i % n) + n) % n] as Vec2;
  const unit = (v: Vec2): Vec2 => {
    const l = Math.hypot(v[0], v[1]) || 1;
    return [v[0] / l, v[1] / l];
  };
  const tangents: Vec2[] = points.map((_, i) => (closed || (i > 0 && i < n - 1) ? unit([at(i + 1)[0] - at(i - 1)[0], at(i + 1)[1] - at(i - 1)[1]]) : [0, 0]));
  if (!closed) {
    const chord = (i: number, j: number) => unit([at(j)[0] - at(i)[0], at(j)[1] - at(i)[1]]);
    const mirror = (c: Vec2, t: Vec2): Vec2 => (n === 2 ? c : unit([2 * c[0] - t[0], 2 * c[1] - t[1]]));
    tangents[0] = mirror(chord(0, 1), tangents[1] as Vec2);
    tangents[n - 1] = mirror(chord(n - 2, n - 1), tangents[n - 2] as Vec2);
  }
  const gaps = closed ? n : n - 1;
  return Array.from({ length: gaps }, (_, i): Bezier => {
    const p = at(i);
    const q = at(i + 1);
    const handle = Math.hypot(q[0] - p[0], q[1] - p[1]) / 3;
    const tp = tangents[i] as Vec2;
    const tq = tangents[(i + 1) % n] as Vec2;
    return [p, [p[0] + tp[0] * handle, p[1] + tp[1] * handle], [q[0] - tq[0] * handle, q[1] - tq[1] * handle], q];
  });
}

/** Points along the curve from t0 to t1, both ends included, no farther than `tolerance` from it. */
export function sampleCurve(curve: ParamCurve, t0: number, t1: number, tolerance = 0.01): Vec2[] {
  // Chord error ≈ |second derivative| · step² / 8: choose the step from the largest curvature term.
  let bend = 0;
  for (let k = 0; k <= 8; k++) {
    const d = curveSecondDerivative(curve, t0 + ((t1 - t0) * k) / 8);
    bend = Math.max(bend, Math.hypot(d[0], d[1]));
  }
  const span = Math.abs(t1 - t0);
  const steps = Math.min(512, Math.max(4, Math.ceil(span / Math.sqrt((8 * tolerance) / Math.max(bend, 1e-12)))));
  return Array.from({ length: steps + 1 }, (_, i) => curveAt(curve, t0 + ((t1 - t0) * i) / steps));
}

/** The parameter in [t0, t1] nearest to `p`, refined by Newton steps from the best sample. */
export function closestParameter(curve: ParamCurve, p: Vec2, t0: number, t1: number): { t: number; distance: number } {
  const steps = 64;
  let best = t0;
  let bestDistance = Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const q = curveAt(curve, t);
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d < bestDistance) [best, bestDistance] = [t, d];
  }
  const [lo, hi] = t0 < t1 ? [t0, t1] : [t1, t0];
  for (let k = 0; k < 20; k++) {
    const q = curveAt(curve, best);
    const d1 = curveDerivative(curve, best);
    const d2 = curveSecondDerivative(curve, best);
    const r: Vec2 = [q[0] - p[0], q[1] - p[1]];
    const f = r[0] * d1[0] + r[1] * d1[1];
    const df = d1[0] ** 2 + d1[1] ** 2 + r[0] * d2[0] + r[1] * d2[1];
    if (Math.abs(df) < 1e-15) break;
    const next = Math.min(hi, Math.max(lo, best - f / df));
    if (Math.abs(next - best) < 1e-14) break;
    best = next;
  }
  const q = curveAt(curve, best);
  return { t: best, distance: Math.hypot(q[0] - p[0], q[1] - p[1]) };
}

/** Gauss–Legendre nodes and weights on [-1, 1] (8 points). */
const nodes = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const weights = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/** ∫ (x dy − y dx) / 2 along the curve from t0 to t1: its share of the area of a loop it bounds. */
export function curveArea(curve: ParamCurve, t0: number, t1: number): number {
  const pieces = 16;
  let sum = 0;
  for (let k = 0; k < pieces; k++) {
    const a = t0 + ((t1 - t0) * k) / pieces;
    const b = t0 + ((t1 - t0) * (k + 1)) / pieces;
    nodes.forEach((x, i) => {
      const t = (a + b) / 2 + ((b - a) / 2) * x;
      const p = curveAt(curve, t);
      const d = curveDerivative(curve, t);
      sum += ((weights[i] as number) * (b - a)) / 2 * (p[0] * d[1] - p[1] * d[0]) / 2;
    });
  }
  return sum;
}
