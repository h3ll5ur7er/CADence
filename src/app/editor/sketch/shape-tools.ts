import type { SketchConstraint, SketchEntity, Vec2 } from '@core/contracts';
import type { DesignCommand } from '@core/managers/design';
import { type IdSource, type PointRef, resolvePoint } from './sketch-tools';

/**
 * Commands of the drawing tools that make more than one curve (slot, polygon, centre rectangle) or
 * other kinds (three-point arc, ellipse, spline). Each keeps its shape with relations, so dragging
 * or dimensioning it later keeps it a slot, a regular polygon, and so on.
 */

type Geometry = Extract<DesignCommand, { type: 'add-sketch-geometry' }>;
/** An entity or constraint before it gets its id (Omit for each member of the union). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

/** Builds one command: new points for free positions, shared ones for snapped positions. */
class Builder {
  readonly entities: SketchEntity[] = [];
  readonly constraints: SketchConstraint[] = [];

  constructor(private readonly newId: IdSource) {}

  point(ref: PointRef | Vec2): string {
    return resolvePoint(Array.isArray(ref) ? { at: ref as Vec2 } : (ref as PointRef), this.newId, this.entities, this.constraints);
  }

  add(entity: WithoutId<SketchEntity>): string {
    const id = this.newId();
    this.entities.push({ ...entity, id } as SketchEntity);
    return id;
  }

  relate(constraint: WithoutId<SketchConstraint>): void {
    this.constraints.push({ ...constraint, id: this.newId() } as SketchConstraint);
  }

  command(sketchId: string): Geometry {
    return { type: 'add-sketch-geometry', sketchId, entities: this.entities, constraints: this.constraints };
  }
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const along = (p: Vec2, d: Vec2, s: number): Vec2 => [p[0] + d[0] * s, p[1] + d[1] * s];
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
/** Distance of `p` from the line through `a` and `b`. */
const offLine = (p: Vec2, a: Vec2, b: Vec2): number => {
  const d = unit(sub(b, a));
  return Math.abs(d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0]));
};

/**
 * A slot: two half circles around the centres `a` and `b`, joined by two straight sides, as wide as
 * twice the distance of `width` from the centre line. The sides are tangent to the ends, which have
 * equal radii.
 */
export function slotCommand(sketchId: string, a: PointRef, b: PointRef, width: Vec2, newId: IdSource): Geometry | undefined {
  const r = offLine(width, a.at, b.at);
  const d = unit(sub(b.at, a.at));
  if (r < 1e-6 || Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]) < 1e-6) return undefined;
  const n: Vec2 = [-d[1], d[0]];
  const s = new Builder(newId);
  const [ca, cb] = [s.point(a), s.point(b)];
  const a1 = s.point(along(a.at, n, r));
  const a2 = s.point(along(a.at, n, -r));
  const b1 = s.point(along(b.at, n, r));
  const b2 = s.point(along(b.at, n, -r));
  // Counter-clockwise: the far end runs from below to above the centre line, the near end back.
  const endB = s.add({ kind: 'arc', center: cb, start: b2, end: b1, construction: false });
  const endA = s.add({ kind: 'arc', center: ca, start: a1, end: a2, construction: false });
  const top = s.add({ kind: 'line', start: b1, end: a1, construction: false });
  const bottom = s.add({ kind: 'line', start: a2, end: b2, construction: false });
  for (const side of [top, bottom]) for (const end of [endA, endB]) s.relate({ kind: 'tangent', curves: [side, end] });
  s.relate({ kind: 'equal', curves: [endA, endB] });
  return s.command(sketchId);
}

/**
 * A regular polygon with `sides` corners on a construction circle around `center`, one corner at
 * `corner`. Equal sides keep it regular.
 */
export function polygonCommand(sketchId: string, center: PointRef, corner: Vec2, sides: number, newId: IdSource): Geometry | undefined {
  const r = Math.hypot(corner[0] - center.at[0], corner[1] - center.at[1]);
  if (r < 1e-6 || sides < 3) return undefined;
  const start = Math.atan2(corner[1] - center.at[1], corner[0] - center.at[0]);
  const s = new Builder(newId);
  const c = s.point(center);
  const circle = s.add({ kind: 'circle', center: c, radius: r, construction: true });
  const corners = Array.from({ length: sides }, (_, i) => {
    const angle = start + (2 * Math.PI * i) / sides;
    return s.point([center.at[0] + r * Math.cos(angle), center.at[1] + r * Math.sin(angle)]);
  });
  const lines = corners.map((p, i) => s.add({ kind: 'line', start: p, end: corners[(i + 1) % sides] as string, construction: false }));
  for (const p of corners) s.relate({ kind: 'point-on', point: p, curve: circle });
  for (let i = 1; i < sides; i++) s.relate({ kind: 'equal', curves: [lines[0] as string, lines[i] as string] });
  return s.command(sketchId);
}

/** A rectangle around `center` with a corner at `corner`: horizontal and vertical sides, centred by a construction diagonal. */
export function centerRectangleCommand(sketchId: string, center: PointRef, corner: Vec2, newId: IdSource): Geometry | undefined {
  const [dx, dy] = sub(corner, center.at);
  if (Math.abs(dx) < 1e-6 || Math.abs(dy) < 1e-6) return undefined;
  const s = new Builder(newId);
  const c = s.point(center);
  const [x, y] = center.at;
  const ps = ([[x - dx, y - dy], [x + dx, y - dy], [x + dx, y + dy], [x - dx, y + dy]] as Vec2[]).map((p) => s.point(p));
  const [p0, p1, p2, p3] = ps as [string, string, string, string];
  const bottom = s.add({ kind: 'line', start: p0, end: p1, construction: false });
  const right = s.add({ kind: 'line', start: p1, end: p2, construction: false });
  const top = s.add({ kind: 'line', start: p2, end: p3, construction: false });
  const left = s.add({ kind: 'line', start: p3, end: p0, construction: false });
  const diagonal = s.add({ kind: 'line', start: p0, end: p2, construction: true });
  s.relate({ kind: 'horizontal', line: bottom });
  s.relate({ kind: 'horizontal', line: top });
  s.relate({ kind: 'vertical', line: left });
  s.relate({ kind: 'vertical', line: right });
  s.relate({ kind: 'midpoint', point: c, line: diagonal });
  return s.command(sketchId);
}

/** The centre of the circle through three points, if they are not on one line. */
export function circleThrough(a: Vec2, b: Vec2, c: Vec2): Vec2 | undefined {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return undefined;
  const sq = (p: Vec2) => p[0] * p[0] + p[1] * p[1];
  return [
    (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d,
    (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d,
  ];
}

/** An arc from `start` to `end` through `through`; stored counter-clockwise, so it may run from `end` to `start`. */
export function threePointArcCommand(sketchId: string, start: PointRef, end: PointRef, through: Vec2, newId: IdSource): Geometry | undefined {
  const center = circleThrough(start.at, end.at, through);
  if (!center) return undefined;
  const angle = (p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const ccw = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Counter-clockwise from start, the arc passes `through` before it reaches `end`, or it runs the other way.
  const forward = ccw(angle(start.at), angle(through)) < ccw(angle(start.at), angle(end.at));
  const s = new Builder(newId);
  const [from, to] = forward ? [s.point(start), s.point(end)] : [s.point(end), s.point(start)];
  s.add({ kind: 'arc', center: s.point(center), start: from, end: to, construction: false });
  return s.command(sketchId);
}

/** An ellipse around `center`, its major axis ending at `major`, as wide across as `side` is from that axis. */
export function ellipseCommand(sketchId: string, center: PointRef, major: PointRef, side: Vec2, newId: IdSource): Geometry | undefined {
  const minorRadius = offLine(side, center.at, major.at);
  if (minorRadius < 1e-6 || Math.hypot(major.at[0] - center.at[0], major.at[1] - center.at[1]) < 1e-6) return undefined;
  const s = new Builder(newId);
  s.add({ kind: 'ellipse', center: s.point(center), major: s.point(major), minorRadius, construction: false });
  return s.command(sketchId);
}

/** A spline through the clicked points; closed when the last click is back on the first point. */
export function splineCommand(sketchId: string, clicks: readonly PointRef[], newId: IdSource): Geometry | undefined {
  const first = clicks[0];
  const last = clicks.at(-1);
  const closed = clicks.length > 3 && !!first && !!last && ((first.id !== undefined && first.id === last.id) || Math.hypot(first.at[0] - last.at[0], first.at[1] - last.at[1]) < 1e-9);
  const through = closed ? clicks.slice(0, -1) : clicks;
  if (through.length < 2) return undefined;
  const s = new Builder(newId);
  const points = through.map((p) => s.point(p));
  s.add({ kind: 'spline', points, closed, construction: false });
  return s.command(sketchId);
}

/** The drawing tools of this file, and how many clicks each needs (a spline ends on a double-click). */
export const shapeClicks = { slot: 3, polygon: 2, 'center-rectangle': 2, 'three-point-arc': 3, ellipse: 3, spline: Infinity } as const;
export type ShapeTool = keyof typeof shapeClicks;
export const isShapeTool = (tool: string): tool is ShapeTool => tool in shapeClicks;

/** The command a shape tool makes from its clicks, once there are enough of them. */
export function shapeCommand(tool: ShapeTool, sketchId: string, clicks: readonly PointRef[], sides: number, newId: IdSource): Geometry | undefined {
  const [a, b, c] = clicks;
  switch (tool) {
    case 'slot':
      return a && b && c ? slotCommand(sketchId, a, b, c.at, newId) : undefined;
    case 'polygon':
      return a && b ? polygonCommand(sketchId, a, b.at, sides, newId) : undefined;
    case 'center-rectangle':
      return a && b ? centerRectangleCommand(sketchId, a, b.at, newId) : undefined;
    case 'three-point-arc':
      return a && b && c ? threePointArcCommand(sketchId, a, b, c.at, newId) : undefined;
    case 'ellipse':
      return a && b && c ? ellipseCommand(sketchId, a, b, c.at, newId) : undefined;
    case 'spline':
      return splineCommand(sketchId, clicks, newId);
  }
}
