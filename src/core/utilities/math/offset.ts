import { ellipseParameter, sampleCurve } from './curves';
import { type Vec2, add, angleOf, ccwSweep, circleCircle, circleLine, cross, distance, dot, lineLine, scale, sub } from './index';

/** What an offset loop is made of: offsetting turns free-form pieces into short lines. */
export type LineOrArc =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'arc'; readonly start: Vec2; readonly end: Vec2; readonly center: Vec2; readonly radius: number; readonly ccw: boolean };

/**
 * A piece of a closed loop: a line, an arc around `center` run counter-clockwise when `ccw`, a cubic
 * Bézier, or a piece of an ellipse (semi-axes `a` along `rotation`, and `b`).
 */
export type LoopEdge =
  | LineOrArc
  | { readonly kind: 'bezier'; readonly start: Vec2; readonly end: Vec2; readonly c1: Vec2; readonly c2: Vec2 }
  | {
      readonly kind: 'ellipse';
      readonly start: Vec2;
      readonly end: Vec2;
      readonly center: Vec2;
      readonly a: number;
      readonly b: number;
      readonly rotation: number;
      readonly ccw: boolean;
    };

type Mutable<T> = T extends unknown ? { -readonly [K in keyof T]: T[K] } : never;
type Edge = Mutable<LineOrArc>;

/** How closely free-form pieces are followed by the lines that stand in for them when offsetting (mm). */
const flattening = 0.002;

/** Lines and arcs offset exactly; Béziers and ellipse pieces become short lines first. */
function linesAndArcs(edge: LoopEdge): LineOrArc[] {
  if (edge.kind === 'line' || edge.kind === 'arc') return [edge];
  let points: Vec2[];
  if (edge.kind === 'bezier') {
    points = sampleCurve({ kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] }, 0, 1, flattening);
  } else {
    const ellipse = { center: edge.center, a: edge.a, b: edge.b, rotation: edge.rotation };
    const t0 = ellipseParameter(ellipse, edge.start);
    let t1 = ellipseParameter(ellipse, edge.end);
    if (edge.ccw) while (t1 <= t0 + 1e-12) t1 += 2 * Math.PI;
    else while (t1 >= t0 - 1e-12) t1 -= 2 * Math.PI;
    points = sampleCurve({ kind: 'ellipse', ellipse }, t0, t1, flattening);
  }
  points[0] = edge.start;
  points[points.length - 1] = edge.end;
  return points.slice(1).map((end, i) => ({ kind: 'line', start: points[i] as Vec2, end }));
}

const tolerance = 1e-9;

/**
 * Moves a closed loop `by` mm to the right of its direction of travel (left when negative).
 * Profile loops have their material on the left, so a positive distance grows the part, which is
 * kerf compensation. Corners stay sharp: neighbouring edges are extended or trimmed to meet.
 * Returns nothing when a detail is smaller than the offset (an arc or edge would vanish or flip).
 */
export function offsetLoop(loop: readonly LoopEdge[], by: number): LineOrArc[] | undefined {
  const edges = loop.flatMap(linesAndArcs);
  const moved: Edge[] = [];
  for (const edge of edges) {
    const next = shift(edge, by);
    if (!next) return undefined;
    moved.push(next);
  }
  const result: Edge[] = [];
  moved.forEach((edge, i) => {
    const following = moved[(i + 1) % moved.length] as Edge;
    result.push(edge);
    const corner = (edges[i] as LineOrArc).end;
    if (near(edge.end, following.start)) {
      following.start = edge.end;
      return;
    }
    const meeting = closest(crossings(edge, following), corner);
    if (meeting && distance(meeting, corner) <= 4 * Math.abs(by) + tolerance) {
      edge.end = meeting;
      following.start = meeting;
      return;
    }
    // The curves do not meet near the corner: go round it, as the laser beam does.
    result.push({ kind: 'arc', start: edge.end, end: following.start, center: corner, radius: Math.abs(by), ccw: cross(sub(edge.end, corner), sub(following.start, corner)) > 0 });
  });
  // An edge that turned around was shorter than the offset.
  const valid = moved.every((edge, i) => {
    const original = edges[i] as LineOrArc;
    if (edge.kind === 'line' && original.kind === 'line') return dot(sub(edge.end, edge.start), sub(original.end, original.start)) > 0;
    if (edge.kind === 'arc' && original.kind === 'arc') return Math.abs(sweepOf(edge) - sweepOf(original)) < Math.PI;
    return true;
  });
  return valid ? result : undefined;
}

function shift(edge: LineOrArc, d: number): Edge | undefined {
  if (edge.kind === 'line') {
    const direction = sub(edge.end, edge.start);
    const length = Math.hypot(direction[0], direction[1]);
    if (length < tolerance) return undefined;
    const right: Vec2 = [direction[1] / length, -direction[0] / length];
    return { kind: 'line', start: add(edge.start, scale(right, d)), end: add(edge.end, scale(right, d)) };
  }
  // Running counter-clockwise, the centre is on the left: moving right grows the radius.
  const radius = edge.radius + (edge.ccw ? d : -d);
  if (radius <= tolerance) return undefined;
  const along = (p: Vec2) => add(edge.center, scale(sub(p, edge.center), radius / edge.radius));
  return { ...edge, start: along(edge.start), end: along(edge.end), radius };
}

function crossings(a: LineOrArc, b: LineOrArc): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a.start, a.end, b.start, b.end);
  if (a.kind === 'arc' && b.kind === 'arc') return circleCircle(a.center, a.radius, b.center, b.radius);
  const [line, arc] = (a.kind === 'line' ? [a, b] : [b, a]) as [Extract<LineOrArc, { kind: 'line' }>, Extract<LineOrArc, { kind: 'arc' }>];
  return circleLine(arc.center, arc.radius, line.start, line.end);
}

const sweepOf = (arc: Extract<LineOrArc, { kind: 'arc' }>) => {
  const a = angleOf(sub(arc.start, arc.center));
  const b = angleOf(sub(arc.end, arc.center));
  return arc.ccw ? ccwSweep(a, b) : ccwSweep(b, a);
};

const near = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
const closest = (points: Vec2[], to: Vec2) => points.sort((p, q) => distance(p, to) - distance(q, to))[0];
