import { type Sketch, sketchOriginId } from '@core/contracts';
import { angleOf, ccwSweep, distance, polar, sub, type Vec2 } from '@core/utilities/math';

/** The drawable (non-construction) curves of a solved sketch, in sketch coordinates (mm). */
export type DrawingCurve =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number }
  | { readonly kind: 'arc'; readonly center: Vec2; readonly radius: number; readonly startAngle: number; readonly sweep: number };

export function drawingCurves(sketch: Sketch): DrawingCurve[] {
  const points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  return sketch.entities.flatMap((e): DrawingCurve[] => {
    if (e.kind === 'point' || e.construction) return [];
    if (e.kind === 'line') return [{ kind: 'line', start: at(e.start), end: at(e.end) }];
    if (e.kind === 'circle') return [{ kind: 'circle', center: at(e.center), radius: e.radius }];
    const center = at(e.center);
    const startAngle = angleOf(sub(at(e.start), center));
    return [{ kind: 'arc', center, radius: distance(at(e.start), center), startAngle, sweep: ccwSweep(startAngle, angleOf(sub(at(e.end), center))) }];
  });
}

export interface Bounds {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** Exact bounds: arcs contribute their end points and every axis extreme they pass. */
export function boundsOf(curves: readonly DrawingCurve[]): Bounds {
  const points: Vec2[] = curves.flatMap((c): Vec2[] => {
    if (c.kind === 'line') return [c.start, c.end];
    if (c.kind === 'circle') return [0, 1, 2, 3].map((q) => polar(c.center, c.radius, (q * Math.PI) / 2));
    const extremes = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((q) => (q * Math.PI) / 2)
      .filter((a) => a > c.startAngle && a < c.startAngle + c.sweep);
    return [c.startAngle, c.startAngle + c.sweep, ...extremes].map((a) => polar(c.center, c.radius, a));
  });
  if (points.length === 0) return { min: [0, 0], max: [0, 0] };
  return {
    min: [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
    max: [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
  };
}

/** Numbers without float noise ("12.5", not "12.500000000001"). */
export const num = (value: number): string => {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? '0' : String(rounded);
};
