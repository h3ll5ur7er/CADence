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
