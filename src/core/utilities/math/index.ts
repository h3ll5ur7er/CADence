/** 2D vector helpers on plain `[x, y]` tuples. */
export type Vec2 = readonly [number, number];

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const angleOf = (a: Vec2): number => Math.atan2(a[1], a[0]);
export const polar = (center: Vec2, radius: number, angle: number): Vec2 => [
  center[0] + radius * Math.cos(angle),
  center[1] + radius * Math.sin(angle),
];

/** Angle normalized to [0, 2π). */
export const normalizeAngle = (angle: number): number => {
  const full = 2 * Math.PI;
  return ((angle % full) + full) % full;
};

/** Counter-clockwise sweep from `start` to `end`, in (0, 2π]. */
export const ccwSweep = (start: number, end: number): number => {
  const sweep = normalizeAngle(end - start);
  return sweep === 0 ? 2 * Math.PI : sweep;
};

/** Signed area of a closed polygon; positive when counter-clockwise. */
export const signedArea = (polygon: readonly Vec2[]): number => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i] as Vec2;
    const b = polygon[(i + 1) % polygon.length] as Vec2;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
};

/** Even-odd point-in-polygon test. */
export const containsPoint = (polygon: readonly Vec2[], p: Vec2): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] as Vec2;
    const [xj, yj] = polygon[j] as Vec2;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Where the infinite lines through a–b and c–d cross; none when parallel. */
export function lineLine(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2[] {
  const r = sub(b, a);
  const q = sub(d, c);
  const denominator = cross(r, q);
  if (Math.abs(denominator) < 1e-12) return [];
  const u = cross(sub(c, a), q) / denominator;
  return [[a[0] + u * r[0], a[1] + u * r[1]]];
}

/** Where the circle (c, r) meets the infinite line through a–b. */
export function circleLine(c: Vec2, r: number, a: Vec2, b: Vec2, tolerance = 1e-6): Vec2[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = d[0] ** 2 + d[1] ** 2;
  const B = 2 * (f[0] * d[0] + f[1] * d[1]);
  const C = f[0] ** 2 + f[1] ** 2 - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -tolerance) return [];
  const root = Math.sqrt(Math.max(disc, 0));
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)].map((t) => [a[0] + t * d[0], a[1] + t * d[1]] as Vec2);
}

/** Where two circles meet. */
export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number, tolerance = 1e-6): Vec2[] {
  const d = distance(c1, c2);
  if (d < tolerance || d > r1 + r2 + tolerance || d < Math.abs(r1 - r2) - tolerance) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const m: Vec2 = [c1[0] + (a * (c2[0] - c1[0])) / d, c1[1] + (a * (c2[1] - c1[1])) / d];
  const o: Vec2 = [(h * (c2[1] - c1[1])) / d, (-h * (c2[0] - c1[0])) / d];
  return [
    [m[0] + o[0], m[1] + o[1]],
    [m[0] - o[0], m[1] - o[1]],
  ];
}

export { type LoopEdge, offsetLoop } from './offset';
