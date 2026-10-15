import { type PlaneFrame, type Profile, type Sketch, type SketchCurve, sketchOriginId, type Vec2 } from '@core/contracts';
import { ellipseOf, type ParamCurve, sampleCurve, splineBeziers } from '@core/utilities/math';

/** What the 3D scene draws of a sketch that is not being edited: polylines in plane coordinates. */
export interface SketchDisplay {
  readonly id: string;
  readonly frame: PlaneFrame;
  readonly curves: readonly (readonly Vec2[])[];
  readonly construction: readonly (readonly Vec2[])[];
  readonly profiles: readonly Profile[];
}

const arcStep = Math.PI / 48;

export function pointsOf(sketch: Sketch): Map<string, Vec2> {
  const points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  return points;
}

/** Samples an arc counter-clockwise from `start` to `end` around `center`. */
export function sampleArc(center: Vec2, start: Vec2, end: Vec2): Vec2[] {
  const r = Math.hypot(start[0] - center[0], start[1] - center[1]);
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let sweep = Math.atan2(end[1] - center[1], end[0] - center[0]) - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(sweep / arcStep));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + (sweep * i) / steps;
    return [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)] as Vec2;
  });
}

export function sampleCircle(center: Vec2, radius: number): Vec2[] {
  const steps = Math.ceil((2 * Math.PI) / arcStep);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = (2 * Math.PI * i) / steps;
    return [center[0] + radius * Math.cos(a), center[1] + radius * Math.sin(a)] as Vec2;
  });
}

/** An ellipse or a spline as parametric pieces (an ellipse is one, a spline one Bézier per gap). */
export function freeformPieces(e: Extract<SketchCurve, { kind: 'ellipse' | 'spline' }>, at: (id: string) => Vec2): { curve: ParamCurve; t0: number; t1: number }[] {
  if (e.kind === 'ellipse') return [{ curve: { kind: 'ellipse', ellipse: ellipseOf(at(e.center), at(e.major), e.minorRadius) }, t0: 0, t1: 2 * Math.PI }];
  return splineBeziers(e.points.map(at), e.closed).map((points) => ({ curve: { kind: 'bezier', points }, t0: 0, t1: 1 }));
}

/** A sketch curve as a polyline, close enough for display (0.02 mm). */
export function curvePolyline(e: SketchCurve, at: (id: string) => Vec2): Vec2[] {
  switch (e.kind) {
    case 'line':
      return [at(e.start), at(e.end)];
    case 'circle':
      return sampleCircle(at(e.center), e.radius);
    case 'arc':
      return sampleArc(at(e.center), at(e.start), at(e.end));
    default:
      return freeformPieces(e, at).flatMap(({ curve, t0, t1 }, i) => sampleCurve(curve, t0, t1, 0.02).slice(i === 0 ? 0 : 1));
  }
}

export function sketchDisplay(sketch: Sketch, profiles: readonly Profile[], frame: PlaneFrame): SketchDisplay {
  const points = pointsOf(sketch);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const curves: Vec2[][] = [];
  const construction: Vec2[][] = [];
  for (const e of sketch.entities) {
    if (e.kind === 'point') continue;
    (e.construction ? construction : curves).push(curvePolyline(e, at));
  }
  return { id: sketch.id, frame, curves, construction, profiles };
}
