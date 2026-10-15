import { type Vec2 } from './index';

/** A piece of a fitted polyline: a line, or an arc around `center` running counter-clockwise when `ccw`. */
export type FittedPiece =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'arc'; readonly start: Vec2; readonly end: Vec2; readonly center: Vec2; readonly radius: number; readonly ccw: boolean };

/** Radii beyond this are straight for all practical purposes (mm). */
const straight = 1e5;

function circleThrough(a: Vec2, b: Vec2, c: Vec2): { center: Vec2; radius: number } | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return undefined;
  const sq = (p: Vec2) => p[0] * p[0] + p[1] * p[1];
  const center: Vec2 = [
    (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d,
    (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d,
  ];
  return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
}

/** The line from points[i] to points[j], if every point between stays within `tolerance` of it. */
function lineFit(points: readonly Vec2[], i: number, j: number, tolerance: number): FittedPiece | undefined {
  const [a, b] = [points[i] as Vec2, points[j] as Vec2];
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(d[0], d[1]);
  if (length < 1e-12) return undefined;
  for (let k = i + 1; k < j; k++) {
    const p = points[k] as Vec2;
    const along = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (length * length);
    if (along < -1e-9 || along > 1 + 1e-9) return undefined;
    if (Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / length > tolerance) return undefined;
  }
  return { kind: 'line', start: a, end: b };
}

/** The arc from points[i] to points[j] through the point between, if every point between stays within `tolerance` of it, in order. */
function arcFit(points: readonly Vec2[], i: number, j: number, tolerance: number): FittedPiece | undefined {
  if (j - i < 2) return undefined;
  const [a, b] = [points[i] as Vec2, points[j] as Vec2];
  const circle = circleThrough(a, points[Math.floor((i + j) / 2)] as Vec2, b);
  if (!circle || circle.radius > straight) return undefined;
  const { center, radius } = circle;
  const angle = (p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const turn = (from: number, to: number) => {
    const t = to - from;
    return t > Math.PI ? t - 2 * Math.PI : t < -Math.PI ? t + 2 * Math.PI : t;
  };
  let total = 0;
  let previous = angle(a);
  for (let k = i + 1; k <= j; k++) {
    const p = points[k] as Vec2;
    if (Math.abs(Math.hypot(p[0] - center[0], p[1] - center[1]) - radius) > tolerance) return undefined;
    const step = turn(previous, angle(p));
    // The points must keep turning one way round, and the arc stay short of a full circle.
    if (total !== 0 && Math.sign(step) !== Math.sign(total) && Math.abs(step) > 1e-12) return undefined;
    total += step;
    previous = angle(p);
  }
  if (Math.abs(total) >= 2 * Math.PI - 1e-6) return undefined;
  // Chords between samples must stay within the tolerance too (an arc's sagitta).
  for (let k = i; k < j; k++) {
    const [p, q] = [points[k] as Vec2, points[k + 1] as Vec2];
    const chord = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (radius - Math.sqrt(Math.max(radius * radius - (chord * chord) / 4, 0)) > tolerance * 4) return undefined;
  }
  return { kind: 'arc', start: a, end: b, center, radius, ccw: total > 0 };
}

/**
 * Lines and arcs through a polyline's points that stay within `tolerance` of every point, as few as
 * a greedy pass finds: from each piece's start, the longest arc or line that fits. The pieces join
 * at points of the polyline, so the first starts and the last ends exactly where it does.
 */
export function fitArcs(points: readonly Vec2[], tolerance: number): FittedPiece[] {
  const pieces: FittedPiece[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let best: FittedPiece = { kind: 'line', start: points[i] as Vec2, end: points[i + 1] as Vec2 };
    let bestEnd = i + 1;
    const fits = (j: number) => arcFit(points, i, j, tolerance) ?? lineFit(points, i, j, tolerance);
    // Grow while it fits (doubling), then narrow down between the last fit and the first miss.
    let step = 1;
    let miss = points.length;
    for (let j = i + 2; j < points.length; j = i + 1 + (step *= 2)) {
      const piece = fits(j);
      if (!piece) {
        miss = j;
        break;
      }
      [best, bestEnd] = [piece, j];
    }
    let [lo, hi] = [bestEnd, Math.min(miss, points.length)];
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      const piece = fits(mid);
      if (piece) [best, bestEnd, lo] = [piece, mid, mid];
      else hi = mid;
    }
    // A straight run counts as a line even when a huge arc would also fit.
    const line = lineFit(points, i, bestEnd, tolerance);
    pieces.push(line ?? best);
    i = bestEnd;
  }
  return pieces;
}
