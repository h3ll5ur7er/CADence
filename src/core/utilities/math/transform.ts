/**
 * Rigid 3D transforms as 4 × 4 matrices in column-major order (the layout three.js and WebGPU use):
 * element (row r, column c) is at index `c * 4 + r`, and the translation is at 12, 13, 14.
 */
export type Matrix4 = readonly number[];
export type Vec3 = readonly [number, number, number];

export const identity = (): Matrix4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + r] as number) * (b[c * 4 + k] as number);
      out[c * 4 + r] = sum;
    }
  return out;
}

/** Product of several transforms, applied right to left. */
export const compose = (...matrices: Matrix4[]): Matrix4 => matrices.reduce((m, n) => multiply(m, n), identity());

/** The transform taking local coordinates of a frame (axes x, y, z at origin) to world coordinates. */
export const fromFrame = (origin: Vec3, x: Vec3, y: Vec3, z: Vec3): Matrix4 => [...x, 0, ...y, 0, ...z, 0, ...origin, 1];

export const translation = (v: Vec3): Matrix4 => fromFrame(v, [1, 0, 0], [0, 1, 0], [0, 0, 1]);

/** Rotation by `angle` radians about a unit axis through the origin (Rodrigues). */
export function rotation(axis: Vec3, angle: number): Matrix4 {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1];
}

/** Inverse of a rigid transform (rotation and translation only). */
export function invertRigid(m: Matrix4): Matrix4 {
  const at = (i: number) => m[i] as number;
  const [tx, ty, tz] = [at(12), at(13), at(14)];
  // The rotation is transposed; the translation is −Rᵀ·t (Rᵀ's rows are R's columns).
  const column = (c: number) => -(at(c * 4) * tx + at(c * 4 + 1) * ty + at(c * 4 + 2) * tz);
  return [at(0), at(4), at(8), 0, at(1), at(5), at(9), 0, at(2), at(6), at(10), 0, column(0), column(1), column(2), 1];
}

export function transformPoint(m: Matrix4, p: Vec3): Vec3 {
  const at = (i: number) => m[i] as number;
  return [
    at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12),
    at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13),
    at(2) * p[0] + at(6) * p[1] + at(10) * p[2] + at(14),
  ];
}

export const translationOf = (m: Matrix4): Vec3 => [m[12] as number, m[13] as number, m[14] as number];

/** The rotation of a transform as axis × angle (radians); zero for no rotation. */
export function rotationVector(m: Matrix4): Vec3 {
  const at = (i: number) => m[i] as number;
  const trace = at(0) + at(5) + at(10);
  const angle = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
  // Skew-symmetric part: (R - Rᵀ) / 2 = sin(angle) · [axis]×
  const v: Vec3 = [(at(6) - at(9)) / 2, (at(8) - at(2)) / 2, (at(1) - at(4)) / 2];
  const sine = Math.hypot(...v);
  if (sine < 1e-9) {
    if (angle < 1e-6) return [0, 0, 0];
    // Half a turn: the axis is the column of R + I with the largest norm.
    const columns: Vec3[] = [0, 1, 2].map((c) => [at(c * 4) + (c === 0 ? 1 : 0), at(c * 4 + 1) + (c === 1 ? 1 : 0), at(c * 4 + 2) + (c === 2 ? 1 : 0)]);
    const axis = columns.sort((a, b) => Math.hypot(...b) - Math.hypot(...a))[0] as Vec3;
    const length = Math.hypot(...axis);
    return [(axis[0] / length) * angle, (axis[1] / length) * angle, (axis[2] / length) * angle];
  }
  return [(v[0] / sine) * angle, (v[1] / sine) * angle, (v[2] / sine) * angle];
}
