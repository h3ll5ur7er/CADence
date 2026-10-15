import { type Vec2, add, angleOf, ccwSweep, circleCircle, circleLine, cross, distance, dot, lineLine, scale, sub } from './index';

/** A piece of a closed loop: a line, or an arc around `center` run counter-clockwise when `ccw`. */
export type LoopEdge =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'arc'; readonly start: Vec2; readonly end: Vec2; readonly center: Vec2; readonly radius: number; readonly ccw: boolean };

type Mutable<T> = T extends unknown ? { -readonly [K in keyof T]: T[K] } : never;
type Edge = Mutable<LoopEdge>;

const tolerance = 1e-9;

/**
 * Moves a closed loop `by` mm to the right of its direction of travel (left when negative).
 * Profile loops have their material on the left, so a positive distance grows the part, which is
 * kerf compensation. Corners stay sharp: neighbouring edges are extended or trimmed to meet.
 * Returns nothing when a detail is smaller than the offset (an arc or edge would vanish or flip).
 */
export function offsetLoop(edges: readonly LoopEdge[], by: number): LoopEdge[] | undefined {
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
    const corner = (edges[i] as LoopEdge).end;
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
    const original = edges[i] as LoopEdge;
    if (edge.kind === 'line' && original.kind === 'line') return dot(sub(edge.end, edge.start), sub(original.end, original.start)) > 0;
    if (edge.kind === 'arc' && original.kind === 'arc') return Math.abs(sweepOf(edge) - sweepOf(original)) < Math.PI;
    return true;
  });
  return valid ? result : undefined;
}

function shift(edge: LoopEdge, d: number): Edge | undefined {
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

function crossings(a: LoopEdge, b: LoopEdge): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') return lineLine(a.start, a.end, b.start, b.end);
  if (a.kind === 'arc' && b.kind === 'arc') return circleCircle(a.center, a.radius, b.center, b.radius);
  const [line, arc] = (a.kind === 'line' ? [a, b] : [b, a]) as [Extract<LoopEdge, { kind: 'line' }>, Extract<LoopEdge, { kind: 'arc' }>];
  return circleLine(arc.center, arc.radius, line.start, line.end);
}

const sweepOf = (arc: Extract<LoopEdge, { kind: 'arc' }>) => {
  const a = angleOf(sub(arc.start, arc.center));
  const b = angleOf(sub(arc.end, arc.center));
  return arc.ccw ? ccwSweep(a, b) : ccwSweep(b, a);
};

const near = (a: Vec2, b: Vec2) => distance(a, b) < 1e-7;
const closest = (points: Vec2[], to: Vec2) => points.sort((p, q) => distance(p, to) - distance(q, to))[0];
