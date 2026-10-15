import {
  type Sketch,
  type SketchArc,
  type SketchCircle,
  type SketchConstraint,
  type SketchEntity,
  type SketchLine,
  sketchOriginId,
} from '@core/contracts';
import { angleOf, circleCircle, circleLine, cross, distance, dot, lineLine, type LoopEdge, offsetChain, sub, type Vec2 } from '@core/utilities/math';

/**
 * Editing tools of the sketcher (docs/User-guide/Sketching.md#edit): trim, extend, split, offset,
 * fillet and chamfer. Each is a pure function of the sketch that returns an edit, or why it cannot
 * be done. They work on lines, circles and arcs; new points that end on another curve keep a
 * point-on relation with it, so the result stays attached when dimensions change.
 */
export interface SketchEdit {
  /** New entities and constraints (ids start with the caller's prefix). */
  readonly add: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
  /** Changed entities, by id. */
  readonly update: readonly SketchEntity[];
  /** Entities and constraints to remove, with what depends on them. */
  readonly remove: readonly string[];
}

export type EditResult = { readonly ok: true; readonly edit: SketchEdit } | { readonly ok: false; readonly reason: string };

type Simple = SketchLine | SketchCircle | SketchArc;
const isSimple = (e: SketchEntity): e is Simple => e.kind === 'line' || e.kind === 'circle' || e.kind === 'arc';
const tolerance = 1e-7;
const fail = (reason: string): EditResult => ({ ok: false, reason });
const twoPi = 2 * Math.PI;
const ccw = (from: number, to: number) => (((to - from) % twoPi) + twoPi) % twoPi;

/** Fresh ids with the caller's prefix. */
function ids(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

class Geometry {
  private readonly points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);

  constructor(readonly sketch: Sketch) {
    for (const e of sketch.entities) if (e.kind === 'point') this.points.set(e.id, [e.x, e.y]);
  }

  at(id: string): Vec2 {
    return this.points.get(id) ?? [0, 0];
  }

  curve(id: string): Simple | undefined {
    const e = this.sketch.entities.find((x) => x.id === id);
    return e && isSimple(e) ? e : undefined;
  }

  radius(c: SketchCircle | SketchArc): number {
    return c.kind === 'circle' ? c.radius : distance(this.at(c.center), this.at(c.start));
  }

  /** Where `p` is along the curve: 0…1 on a line, the counter-clockwise angle from the start on an arc, the angle on a circle. */
  param(c: Simple, p: Vec2): number {
    if (c.kind === 'line') {
      const [a, b] = [this.at(c.start), this.at(c.end)];
      const d = sub(b, a);
      return dot(sub(p, a), d) / (dot(d, d) || 1);
    }
    const angle = angleOf(sub(p, this.at(c.center)));
    return c.kind === 'circle' ? (angle + twoPi) % twoPi : ccw(angleOf(sub(this.at(c.start), this.at(c.center))), angle);
  }

  /** The curve's extent in its parameter: [0, 1] for a line, [0, sweep] for an arc, a whole turn for a circle. */
  span(c: Simple): number {
    if (c.kind === 'line') return 1;
    if (c.kind === 'circle') return twoPi;
    const center = this.at(c.center);
    return ccw(angleOf(sub(this.at(c.start), center)), angleOf(sub(this.at(c.end), center))) || twoPi;
  }

  pointAt(c: Simple, t: number): Vec2 {
    if (c.kind === 'line') {
      const [a, b] = [this.at(c.start), this.at(c.end)];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    const center = this.at(c.center);
    const r = this.radius(c);
    const angle = c.kind === 'circle' ? t : angleOf(sub(this.at(c.start), center)) + t;
    return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
  }

  /** Whether a parameter lies on the curve's extent (all of a circle). */
  within(c: Simple, t: number): boolean {
    if (c.kind === 'circle') return true;
    const span = this.span(c);
    const slack = c.kind === 'line' ? tolerance : tolerance / Math.max(this.radius(c), 1e-9);
    return t >= -slack && t <= span + slack;
  }

  /** Where the full carriers (infinite line, whole circle) of two curves meet. */
  meetings(a: Simple, b: Simple): Vec2[] {
    const carrier = (c: Simple) => (c.kind === 'line' ? { line: [this.at(c.start), this.at(c.end)] as const } : { circle: [this.at(c.center), this.radius(c)] as const });
    const [p, q] = [carrier(a), carrier(b)];
    if (p.line && q.line) return lineLine(p.line[0], p.line[1], q.line[0], q.line[1]);
    if (p.circle && q.circle) return circleCircle(p.circle[0], p.circle[1], q.circle[0], q.circle[1]);
    const line = (p.line ?? q.line) as readonly [Vec2, Vec2];
    const circle = (p.circle ?? q.circle) as readonly [Vec2, number];
    return circleLine(circle[0], circle[1], line[0], line[1]);
  }

  /** Where other curves cross this one, as parameters along it, with the curve crossed. */
  crossings(c: Simple, extended = false): { t: number; at: Vec2; other: string }[] {
    const result: { t: number; at: Vec2; other: string }[] = [];
    for (const other of this.sketch.entities) {
      if (other.id === c.id || !isSimple(other)) continue;
      for (const p of this.meetings(c, other)) {
        if (!this.within(other, this.param(other, p))) continue;
        const t = this.param(c, p);
        if (extended || this.within(c, t)) result.push({ t, at: p, other: other.id });
      }
    }
    return result.sort((x, y) => x.t - y.t);
  }

  /** Entities (other than `except`) that use a point. */
  usersOf(point: string, except: string): SketchEntity[] {
    return this.sketch.entities.filter((e) => e.id !== except && e.kind !== 'point' && JSON.stringify(e).includes(`"${point}"`));
  }
}

/**
 * Removes the piece of a curve between the crossings on either side of `at`: an end piece shortens
 * the curve, a middle piece splits it in two, a curve that crosses nothing is removed.
 */
export function trim(sketch: Sketch, curveId: string, at: Vec2, prefix: string): EditResult {
  const g = new Geometry(sketch);
  const c = g.curve(curveId);
  if (!c) return fail('Trim works on lines, circles and arcs.');
  const id = ids(prefix);
  const t = g.param(c, at);
  const cuts = g.crossings(c);
  const add: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  /** A new point at a crossing, held on the curve it crosses. */
  const pointAt = (cut: { at: Vec2; other: string }): string => {
    const point = id();
    add.push({ id: point, kind: 'point', x: cut.at[0], y: cut.at[1] });
    constraints.push({ id: id(), kind: 'point-on', point, curve: cut.other });
    return point;
  };
  if (c.kind === 'circle') {
    if (cuts.length < 2) return fail('A circle needs two crossings to trim.');
    // The piece clicked lies between the crossings before and after it, going round.
    const after = cuts.find((x) => x.t > t) ?? (cuts[0] as (typeof cuts)[number]);
    const before = [...cuts].reverse().find((x) => x.t < t) ?? (cuts.at(-1) as (typeof cuts)[number]);
    // What stays runs counter-clockwise from the crossing after the click to the one before it.
    const arc: SketchArc = { id: c.id, kind: 'arc', center: c.center, start: pointAt(after), end: pointAt(before), construction: c.construction };
    return { ok: true, edit: { add, constraints, update: [arc], remove: [] } };
  }
  const span = g.span(c);
  const inside = cuts.filter((x) => x.t > tolerance && x.t < span - tolerance);
  const lo = [...inside].reverse().find((x) => x.t < t);
  const hi = inside.find((x) => x.t > t);
  if (!lo && !hi) return { ok: true, edit: { add: [], constraints: [], update: [], remove: [c.id] } };
  if (!lo && hi) return { ok: true, edit: { add, constraints, update: [{ ...c, start: pointAt(hi) }], remove: [] } };
  if (lo && !hi) return { ok: true, edit: { add, constraints, update: [{ ...c, end: pointAt(lo) }], remove: [] } };
  // A middle piece: the curve keeps its start, a new one takes its end.
  const [p, q] = [pointAt(lo as (typeof cuts)[number]), pointAt(hi as (typeof cuts)[number])];
  const rest = id();
  add.push({ ...c, id: rest, start: q, end: c.end });
  constraints.push(c.kind === 'line' ? { id: id(), kind: 'collinear', lines: [c.id, rest] } : { id: id(), kind: 'equal', curves: [c.id, rest] });
  return { ok: true, edit: { add, constraints, update: [{ ...c, end: p }], remove: [] } };
}

/** Lengthens a line or arc at the end nearer to `at`, up to the next curve it would cross. */
export function extend(sketch: Sketch, curveId: string, at: Vec2, prefix: string): EditResult {
  const g = new Geometry(sketch);
  const c = g.curve(curveId);
  if (!c || c.kind === 'circle') return fail('Extend works on lines and arcs.');
  const span = g.span(c);
  const atEnd = distance(at, g.at(c.end)) < distance(at, g.at(c.start));
  const end = atEnd ? c.end : c.start;
  if (g.usersOf(end, c.id).length) return fail('That end is joined to other curves.');
  const cuts = g.crossings(c, true);
  const target = atEnd
    ? cuts.find((x) => (c.kind === 'line' ? x.t > 1 + tolerance : x.t > span + tolerance && x.t < twoPi))
    : c.kind === 'line'
      ? [...cuts].reverse().find((x) => x.t < -tolerance)
      : [...cuts].reverse().find((x) => x.t > span + tolerance);
  if (!target) return fail('There is nothing to extend it to.');
  const id = ids(prefix);
  const moved: SketchEntity = { id: end, kind: 'point', x: target.at[0], y: target.at[1] };
  return { ok: true, edit: { add: [], constraints: [{ id: id(), kind: 'point-on', point: end, curve: target.other }], update: [moved], remove: [] } };
}

/** Breaks a line or arc in two where `at` is on it; the pieces share the new point. */
export function split(sketch: Sketch, curveId: string, at: Vec2, prefix: string): EditResult {
  const g = new Geometry(sketch);
  const c = g.curve(curveId);
  if (!c || c.kind === 'circle') return fail('Split works on lines and arcs.');
  const t = g.param(c, at);
  if (t <= tolerance || t >= g.span(c) - tolerance) return fail('Click inside the curve, not at its end.');
  const id = ids(prefix);
  const point = id();
  const foot = g.pointAt(c, t);
  const rest = id();
  return {
    ok: true,
    edit: {
      add: [{ id: point, kind: 'point', x: foot[0], y: foot[1] }, { ...c, id: rest, start: point, end: c.end }],
      constraints: c.kind === 'line' ? [{ id: id(), kind: 'collinear', lines: [c.id, rest] }] : [],
      update: [{ ...c, end: point }],
      remove: [],
    },
  };
}

/** The two lines meeting at a corner point, each with its direction away from the corner. */
function corner(g: Geometry, pointId: string): { lines: [SketchLine, SketchLine]; away: [Vec2, Vec2]; lengths: [number, number] } | undefined {
  const lines = g.sketch.entities.filter((e): e is SketchLine => e.kind === 'line' && (e.start === pointId || e.end === pointId));
  const others = g.usersOf(pointId, '').filter((e) => e.kind !== 'line');
  if (lines.length !== 2 || others.length) return undefined;
  const corner = g.at(pointId);
  const far = lines.map((l) => g.at(l.start === pointId ? l.end : l.start));
  const away = far.map((p) => {
    const d = sub(p, corner);
    const l = Math.hypot(d[0], d[1]) || 1;
    return [d[0] / l, d[1] / l] as Vec2;
  });
  return { lines: lines as [SketchLine, SketchLine], away: away as [Vec2, Vec2], lengths: far.map((p) => distance(p, corner)) as [number, number] };
}

/** Rounds the corner where two lines meet with an arc of `radius`, tangent to both. */
export function fillet(sketch: Sketch, pointId: string, radius: number, prefix: string): EditResult {
  const g = new Geometry(sketch);
  const found = corner(g, pointId);
  if (!found) return fail('Pick a corner where exactly two lines meet.');
  const { lines, away, lengths } = found;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(away[0], away[1]))));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return fail('The lines are in line: there is no corner to round.');
  const back = radius / Math.tan(angle / 2);
  if (!(radius > 0) || back >= Math.min(...lengths)) return fail('The radius is too large for these lines.');
  const c = g.at(pointId);
  const tangent = away.map((d) => [c[0] + d[0] * back, c[1] + d[1] * back] as Vec2);
  const mid: Vec2 = [away[0][0] + away[1][0], away[0][1] + away[1][1]];
  const midLength = Math.hypot(mid[0], mid[1]);
  const center: Vec2 = [c[0] + (mid[0] / midLength) * (radius / Math.sin(angle / 2)), c[1] + (mid[1] / midLength) * (radius / Math.sin(angle / 2))];
  const id = ids(prefix);
  const [t0, t1, centre, arc] = [id(), id(), id(), id()];
  // Counter-clockwise the short way round from one tangent point to the other.
  const forward = cross(sub(tangent[0] as Vec2, center), sub(tangent[1] as Vec2, center)) > 0;
  const [from, to] = forward ? [t0, t1] : [t1, t0];
  const replace = (l: SketchLine, p: string): SketchLine => (l.start === pointId ? { ...l, start: p } : { ...l, end: p });
  return {
    ok: true,
    edit: {
      add: [
        { id: t0, kind: 'point', x: (tangent[0] as Vec2)[0], y: (tangent[0] as Vec2)[1] },
        { id: t1, kind: 'point', x: (tangent[1] as Vec2)[0], y: (tangent[1] as Vec2)[1] },
        { id: centre, kind: 'point', x: center[0], y: center[1] },
        { id: arc, kind: 'arc', center: centre, start: from, end: to, construction: false },
      ],
      constraints: [
        { id: id(), kind: 'tangent', curves: [lines[0].id, arc] },
        { id: id(), kind: 'tangent', curves: [lines[1].id, arc] },
        { id: id(), kind: 'radius', curve: arc, expression: String(Math.round(radius * 1e6) / 1e6) },
      ],
      update: [replace(lines[0], t0), replace(lines[1], t1)],
      remove: [pointId],
    },
  };
}

/** Cuts the corner where two lines meet with a straight line, `size` back along each. */
export function chamfer(sketch: Sketch, pointId: string, size: number, prefix: string): EditResult {
  const g = new Geometry(sketch);
  const found = corner(g, pointId);
  if (!found) return fail('Pick a corner where exactly two lines meet.');
  const { lines, away, lengths } = found;
  if (!(size > 0) || size >= Math.min(...lengths)) return fail('The chamfer is too large for these lines.');
  const c = g.at(pointId);
  const id = ids(prefix);
  const [p0, p1, cut] = [id(), id(), id()];
  const at = (d: Vec2): Vec2 => [c[0] + d[0] * size, c[1] + d[1] * size];
  const replace = (l: SketchLine, p: string): SketchLine => (l.start === pointId ? { ...l, start: p } : { ...l, end: p });
  return {
    ok: true,
    edit: {
      add: [
        { id: p0, kind: 'point', x: at(away[0])[0], y: at(away[0])[1] },
        { id: p1, kind: 'point', x: at(away[1])[0], y: at(away[1])[1] },
        { id: cut, kind: 'line', start: p0, end: p1, construction: false },
      ],
      constraints: [],
      update: [replace(lines[0], p0), replace(lines[1], p1)],
      remove: [pointId],
    },
  };
}

/**
 * A copy of connected curves (a chain of lines and arcs, or one circle) moved `by` to the side:
 * positive moves to the right of the chain's direction (outward for a counter-clockwise loop).
 * Lines stay parallel and arcs concentric to their originals.
 */
export function offset(sketch: Sketch, curveIds: readonly string[], by: number, prefix: string): EditResult {
  const g = new Geometry(sketch);
  const curves = curveIds.map((i) => g.curve(i));
  if (!curves.length || curves.some((c) => !c)) return fail('Offset works on lines, circles and arcs.');
  if (Math.abs(by) < tolerance) return fail('The offset distance cannot be zero.');
  const id = ids(prefix);
  const first = curves[0] as Simple;
  if (first.kind === 'circle') {
    if (curves.length > 1) return fail('Offset one circle at a time.');
    const radius = first.radius + by;
    if (radius <= tolerance) return fail('The circle would vanish.');
    const circle = id();
    return {
      ok: true,
      edit: {
        add: [{ id: circle, kind: 'circle', center: first.center, radius, construction: first.construction }],
        constraints: [{ id: id(), kind: 'radius', curve: circle, expression: String(Math.round(radius * 1e6) / 1e6) }],
        update: [],
        remove: [],
      },
    };
  }
  const chain = orderChain(g, curves as Simple[]);
  if (!chain) return fail('Select curves that join end to end.');
  const moved = offsetChain(chain.edges, by, chain.closed);
  if (!moved) return fail('The offset is larger than a detail of the curves.');
  // One new point per distinct position, shared where offset pieces meet.
  const add: SketchEntity[] = [];
  const points: { at: Vec2; id: string }[] = [];
  const pointAt = (p: Vec2): string => {
    const found = points.find((x) => distance(x.at, p) < 1e-6);
    if (found) return found.id;
    const point = id();
    points.push({ at: p, id: point });
    add.push({ id: point, kind: 'point', x: p[0], y: p[1] });
    return point;
  };
  const constraints: SketchConstraint[] = [];
  moved.forEach(({ edge, source: index }) => {
    const source = index === undefined ? undefined : chain.sources[index];
    if (edge.kind === 'line') {
      const line = id();
      add.push({ id: line, kind: 'line', start: pointAt(edge.start), end: pointAt(edge.end), construction: false });
      if (source?.kind === 'line') constraints.push({ id: id(), kind: 'parallel', lines: [source.id, line] });
      return;
    }
    if (edge.kind !== 'arc') return;
    const center = source?.kind === 'arc' ? source.center : pointAt(edge.center);
    const [start, end] = edge.ccw ? [edge.start, edge.end] : [edge.end, edge.start];
    add.push({ id: id(), kind: 'arc', center, start: pointAt(start), end: pointAt(end), construction: false });
  });
  const firstLine = add.find((e): e is SketchLine => e.kind === 'line');
  const firstSource = chain.sources.find((s) => s?.kind === 'line');
  if (firstLine && firstSource?.kind === 'line') {
    constraints.push({ id: id(), kind: 'point-line-distance', point: firstLine.start, line: firstSource.id, expression: String(Math.round(Math.abs(by) * 1e6) / 1e6) });
  }
  return { ok: true, edit: { add, constraints, update: [], remove: [] } };
}

/** Lines and arcs joined end to end, in order and direction, as loop edges. */
function orderChain(g: Geometry, curves: readonly Simple[]): { edges: LoopEdge[]; sources: (Simple | undefined)[]; closed: boolean } | undefined {
  const ends = (c: Simple): [string, string] => (c.kind === 'circle' ? ['', ''] : [c.start, c.end]);
  const left = [...curves];
  // Start at a curve with an end no other selected curve shares (an open chain's end), else anywhere.
  const shared = (p: string, except: Simple) => left.some((o) => o !== except && ends(o).includes(p));
  const startCurve = left.find((c) => !shared(ends(c)[0], c) || !shared(ends(c)[1], c)) ?? left[0];
  if (!startCurve) return undefined;
  const order: { curve: Simple; forward: boolean }[] = [];
  let current = startCurve;
  let forward = shared(ends(current)[1], current) || !shared(ends(current)[0], current);
  for (;;) {
    order.push({ curve: current, forward });
    left.splice(left.indexOf(current), 1);
    const tail = forward ? ends(current)[1] : ends(current)[0];
    const next = left.find((c) => ends(c).includes(tail));
    if (!next) break;
    forward = ends(next)[0] === tail;
    current = next;
  }
  if (left.length) return undefined;
  const firstHead = order[0] && (order[0].forward ? ends(order[0].curve)[0] : ends(order[0].curve)[1]);
  const last = order.at(-1);
  const lastTail = last && (last.forward ? ends(last.curve)[1] : ends(last.curve)[0]);
  const closed = order.length > 1 && firstHead === lastTail;
  const edges = order.map(({ curve, forward: f }): LoopEdge => {
    const [s, e] = f ? [g.at(ends(curve)[0]), g.at(ends(curve)[1])] : [g.at(ends(curve)[1]), g.at(ends(curve)[0])];
    if (curve.kind === 'line') return { kind: 'line', start: s, end: e };
    const arc = curve as SketchArc;
    return { kind: 'arc', start: s, end: e, center: g.at(arc.center), radius: g.radius(arc), ccw: f };
  });
  return { edges, sources: order.map((o) => o.curve), closed };
}
