import { type Profile, type Sketch, type SketchPlane, sketchOriginId, type Vec2 } from '@core/contracts';

/** What the 3D scene draws of a sketch that is not being edited: polylines in plane coordinates. */
export interface SketchDisplay {
  readonly id: string;
  readonly plane: SketchPlane;
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

export function sketchDisplay(sketch: Sketch, profiles: readonly Profile[]): SketchDisplay {
  const points = pointsOf(sketch);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const curves: Vec2[][] = [];
  const construction: Vec2[][] = [];
  for (const e of sketch.entities) {
    if (e.kind === 'point') continue;
    const polyline =
      e.kind === 'line' ? [at(e.start), at(e.end)] : e.kind === 'circle' ? sampleCircle(at(e.center), e.radius) : sampleArc(at(e.center), at(e.start), at(e.end));
    (e.construction ? construction : curves).push(polyline);
  }
  return { id: sketch.id, plane: sketch.plane, curves, construction, profiles };
}
