import type { SketchPlane } from '@core/contracts';
import type { StandardView } from './viewport-scene';

/** World axes of a sketch plane's (u, v) coordinates, Z up. Matches the view cube's faces. */
export const planeBasis: Readonly<Record<SketchPlane, { readonly u: readonly [number, number, number]; readonly v: readonly [number, number, number] }>> = {
  XY: { u: [1, 0, 0], v: [0, 1, 0] },
  XZ: { u: [1, 0, 0], v: [0, 0, 1] },
  YZ: { u: [0, 1, 0], v: [0, 0, 1] },
};

/** The view that looks straight at a sketch plane with u to the right and v up. */
export const planeView: Readonly<Record<SketchPlane, StandardView>> = {
  XY: 'top',
  XZ: 'front',
  YZ: 'right',
};

/** Maps sketch-plane coordinates to viewport pixels: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG `matrix()` order). */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const applyAffine = (m: Affine, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

export function invertAffine(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Pixels per millimetre of an affine that is a similarity (uniform scale). */
export const affineScale = (m: Affine): number => Math.hypot(m.a, m.b);
