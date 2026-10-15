import { type Profile, type Sketch, sketchOriginId, type TextOutlines } from '@core/contracts';
import {
  angleOf,
  type Bezier,
  ccwSweep,
  distance,
  type Ellipse,
  ellipseOf,
  offsetLoop,
  type ParamCurve,
  polar,
  sampleCurve,
  splineBeziers,
  sub,
  type Vec2,
} from '@core/utilities/math';

/** The drawable (non-construction) curves of a solved sketch, in sketch coordinates (mm). */
export type DrawingCurve =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number }
  | { readonly kind: 'arc'; readonly center: Vec2; readonly radius: number; readonly startAngle: number; readonly sweep: number }
  /** A cubic Bézier: start, two control points, end (splines are chains of them). */
  | { readonly kind: 'bezier'; readonly points: Bezier }
  /** An ellipse, or the piece of it from parameter `start` counter-clockwise by `sweep` (2π: all of it). */
  | { readonly kind: 'ellipse'; readonly ellipse: Ellipse; readonly start: number; readonly sweep: number };

/** Béziers and ellipses as parametric curves, for sampling. */
export function paramCurveOf(curve: Extract<DrawingCurve, { kind: 'bezier' | 'ellipse' }>): { curve: ParamCurve; t0: number; t1: number } {
  return curve.kind === 'bezier'
    ? { curve: { kind: 'bezier', points: curve.points }, t0: 0, t1: 1 }
    : { curve: { kind: 'ellipse', ellipse: curve.ellipse }, t0: curve.start, t1: curve.start + curve.sweep };
}

/** Points along a Bézier or ellipse, ends included, within `tolerance` mm of it. */
export function samplePoints(curve: Extract<DrawingCurve, { kind: 'bezier' | 'ellipse' }>, tolerance = 0.005): Vec2[] {
  const { curve: c, t0, t1 } = paramCurveOf(curve);
  return sampleCurve(c, t0, t1, tolerance);
}

/** The sketch's curves, with the outlines of its texts (from solving). */
export function drawingCurves(sketch: Sketch, texts: TextOutlines = new Map()): DrawingCurve[] {
  const points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  return sketch.entities.flatMap((e): DrawingCurve[] => {
    if (e.kind === 'point' || e.kind === 'projection' || e.kind === 'drawing' || e.construction) return [];
    if (e.kind === 'text') {
      return (texts.get(e.id) ?? []).flat().flatMap((edge): DrawingCurve[] => {
        if (edge.kind === 'line') return [{ kind: 'line', start: edge.start, end: edge.end }];
        return edge.kind === 'bezier' ? [{ kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] }] : [];
      });
    }
    if (e.kind === 'line') return [{ kind: 'line', start: at(e.start), end: at(e.end) }];
    if (e.kind === 'circle') return [{ kind: 'circle', center: at(e.center), radius: e.radius }];
    if (e.kind === 'ellipse') return [{ kind: 'ellipse', ellipse: ellipseOf(at(e.center), at(e.major), e.minorRadius), start: 0, sweep: 2 * Math.PI }];
    if (e.kind === 'spline') return splineBeziers(e.points.map(at), e.closed).map((points): DrawingCurve => ({ kind: 'bezier', points }));
    const center = at(e.center);
    const startAngle = angleOf(sub(at(e.start), center));
    return [{ kind: 'arc', center, radius: distance(at(e.start), center), startAngle, sweep: ccwSweep(startAngle, angleOf(sub(at(e.end), center))) }];
  });
}

export interface Bounds {
  readonly min: Vec2;
  readonly max: Vec2;
}

/** Exact bounds for lines, circles and arcs (end points and every axis extreme they pass); Béziers and ellipses within 0.005 mm. */
export function boundsOf(curves: readonly DrawingCurve[]): Bounds {
  const points: Vec2[] = curves.flatMap((c): Vec2[] => {
    if (c.kind === 'line') return [c.start, c.end];
    if (c.kind === 'bezier' || c.kind === 'ellipse') return samplePoints(c);
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

/** Kerf compensation: closed outlines of the profiles, moved half a kerf away from the part. */
export interface KerfCompensation {
  readonly profiles: readonly Profile[];
  /** Width of the laser cut, mm. */
  readonly kerf: number;
}

/**
 * The sketch's curves with every profile outline offset by half the kerf (outer loops grow, holes
 * shrink); curves that bound no profile, such as engraving lines, stay where they are.
 */
export function compensatedCurves(sketch: Sketch, { profiles, kerf }: KerfCompensation, texts: TextOutlines = new Map()): DrawingCurve[] {
  const loops = profiles.flatMap((p) => [p.outer, ...p.holes]);
  const bounding = new Set(loops.flatMap((loop) => loop.edges.map((e) => e.source)));
  const loose = drawingCurves({ ...sketch, entities: sketch.entities.filter((e) => e.kind === 'point' || !bounding.has(e.id)) }, texts);
  const outlines = loops.flatMap((loop) => {
    const moved = offsetLoop(loop.edges, kerf / 2);
    if (!moved) throw new Error(`${sketch.name} has details smaller than the kerf (${num(kerf)} mm).`);
    return moved.map((edge): DrawingCurve => {
      if (edge.kind === 'line') return { kind: 'line', start: edge.start, end: edge.end };
      // Drawing arcs run counter-clockwise: a clockwise piece is the same arc from its end.
      const [from, to] = edge.ccw ? [edge.start, edge.end] : [edge.end, edge.start];
      const startAngle = angleOf(sub(from, edge.center));
      return { kind: 'arc', center: edge.center, radius: edge.radius, startAngle, sweep: ccwSweep(startAngle, angleOf(sub(to, edge.center))) };
    });
  });
  return [...loose, ...outlines];
}
