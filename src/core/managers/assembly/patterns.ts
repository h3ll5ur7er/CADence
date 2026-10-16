import type { InstancePattern, Matrix4, Vec3 } from '@core/contracts';
import { compose, rotation, translation } from '@core/utilities/math';

const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

/** Where each copy goes relative to its original's place: k = 1 … count − 1 in a row or around the axis, one for a mirror. */
export function patternTransforms(pattern: InstancePattern): Matrix4[] {
  const d = unit(pattern.direction);
  const o = pattern.origin;
  if (pattern.kind === 'mirror') {
    // Reflection across the plane through o with normal d: I − 2ddᵀ, moved by 2(d·o)d.
    const t = 2 * (d[0] * o[0] + d[1] * o[1] + d[2] * o[2]);
    const r = (i: number, j: number) => (i === j ? 1 : 0) - 2 * (d[i] as number) * (d[j] as number);
    return [[r(0, 0), r(1, 0), r(2, 0), 0, r(0, 1), r(1, 1), r(2, 1), 0, r(0, 2), r(1, 2), r(2, 2), 0, t * d[0], t * d[1], t * d[2], 1]];
  }
  return Array.from({ length: Math.max(0, Math.round(pattern.count) - 1) }, (_, i) => {
    const k = i + 1;
    if (pattern.kind === 'linear') return translation([d[0] * pattern.spacing * k, d[1] * pattern.spacing * k, d[2] * pattern.spacing * k]);
    return compose(translation(o), rotation(d, (pattern.spacing * k * Math.PI) / 180), translation([-o[0], -o[1], -o[2]]));
  });
}

/** The id of the k-th copy (from 1) of an instance in a pattern. */
export const copyId = (pattern: string, instance: string, k: number): string => `${pattern}/${instance}/${k}`;
