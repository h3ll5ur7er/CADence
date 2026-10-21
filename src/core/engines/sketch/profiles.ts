import { type Profile, type ProfileEdge, type ProfileLoop, type Sketch, sketchOriginId, type TextOutlines } from '@core/contracts';
import { contentHash } from '@core/utilities/identity';
import {
  angleOf,
  ccwSweep,
  circleCircle,
  circleLine,
  closestParameter,
  containsPoint,
  cross,
  curveArea,
  curveAt,
  curveDerivative,
  curveSecondDerivative,
  distance,
  ellipseOf,
  lineLine,
  normalizeAngle,
  type ParamCurve,
  polar,
  sampleCurve,
  signedArea,
  splineBeziers,
  splitBezier,
  sub,
  type Vec2,
} from '@core/utilities/math';

/**
 * Finds the closed regions of a sketch: non-construction curves are split at their intersections,
 * the resulting planar graph is walked face by face, and islands become holes of the smallest face
 * around them. Lines and arcs meet exactly; where ellipses and spline pieces (Béziers) cross other
 * curves, the crossing is found numerically, to well below the tolerance.
 */

const tolerance = 1e-6;
const maxArcStep = (2 * Math.PI) / 180;

type Segment =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2; readonly source: string }
  | { readonly kind: 'arc'; readonly c: Vec2; readonly r: number; readonly t0: number; readonly t1: number; readonly source: string }
  | { readonly kind: 'curve'; readonly curve: ParamCurve; readonly t0: number; readonly t1: number; readonly source: string };
type Curve = Extract<Segment, { kind: 'curve' }>;

interface Edge {
  readonly u: number;
  readonly v: number;
  readonly segment: Segment;
}

interface HalfEdge {
  readonly edge: Edge;
  readonly forward: boolean;
  readonly from: number;
  readonly to: number;
  readonly angle: number;
  readonly curvature: number;
}

const startOf = (s: Segment): Vec2 => (s.kind === 'line' ? s.a : s.kind === 'arc' ? polar(s.c, s.r, s.t0) : curveAt(s.curve, s.t0));
const endOf = (s: Segment): Vec2 => (s.kind === 'line' ? s.b : s.kind === 'arc' ? polar(s.c, s.r, s.t1) : curveAt(s.curve, s.t1));

/** Mean length per unit of parameter: turns parameter gaps into millimetres. */
function speedOf(s: Segment): number {
  if (s.kind === 'line') return distance(s.a, s.b);
  if (s.kind === 'arc') return s.r;
  const points = sampleCurve(s.curve, s.t0, s.t1, 0.05);
  const length = points.slice(1).reduce((sum, p, i) => sum + distance(points[i] as Vec2, p), 0);
  return length / Math.abs(s.t1 - s.t0);
}

function segmentsOf(sketch: Sketch, texts: TextOutlines): Segment[] {
  const points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const segments: Segment[] = [];
  for (const e of sketch.entities) {
    if (e.kind === 'point' || e.kind === 'projection' || e.kind === 'drawing' || e.kind === 'equation' || e.kind === 'picture' || e.kind === 'block' || e.construction) continue;
    if (e.kind === 'text') {
      for (const edge of (texts.get(e.id) ?? []).flat()) {
        if (edge.kind === 'line') segments.push({ kind: 'line', a: edge.start, b: edge.end, source: e.id });
        else if (edge.kind === 'bezier') segments.push({ kind: 'curve', curve: { kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] }, t0: 0, t1: 1, source: e.id });
      }
      continue;
    }
    if (e.kind === 'line') {
      segments.push({ kind: 'line', a: at(e.start), b: at(e.end), source: e.id });
    } else if (e.kind === 'circle') {
      const c = at(e.center);
      segments.push({ kind: 'arc', c, r: e.radius, t0: 0, t1: Math.PI, source: e.id });
      segments.push({ kind: 'arc', c, r: e.radius, t0: Math.PI, t1: 2 * Math.PI, source: e.id });
    } else if (e.kind === 'arc') {
      const c = at(e.center);
      const t0 = angleOf(sub(at(e.start), c));
      segments.push({ kind: 'arc', c, r: distance(at(e.start), c), t0, t1: t0 + ccwSweep(t0, angleOf(sub(at(e.end), c))), source: e.id });
    } else if (e.kind === 'ellipse') {
      const curve: ParamCurve = { kind: 'ellipse', ellipse: ellipseOf(at(e.center), at(e.major), e.minorRadius) };
      segments.push({ kind: 'curve', curve, t0: 0, t1: Math.PI, source: e.id }, { kind: 'curve', curve, t0: Math.PI, t1: 2 * Math.PI, source: e.id });
    } else {
      for (const points of splineBeziers(e.points.map(at), e.closed)) segments.push({ kind: 'curve', curve: { kind: 'bezier', points }, t0: 0, t1: 1, source: e.id });
    }
  }
  return segments.filter((s) => {
    if (s.kind === 'line') return distance(s.a, s.b) > tolerance;
    if (s.kind === 'arc') return s.r > tolerance;
    return s.curve.kind === 'ellipse' ? s.curve.ellipse.a > tolerance && s.curve.ellipse.b > tolerance : distance(startOf(s), endOf(s)) > tolerance;
  });
}

/** Parameter of a point known to lie on the segment's carrier (line t ∈ [0,1], arc angle ∈ [t0,t1]). */
function parameterOf(s: Segment, p: Vec2): number | undefined {
  if (s.kind === 'curve') {
    const nearest = closestParameter(s.curve, p, s.t0, s.t1);
    return nearest.distance < tolerance * 10 ? nearest.t : undefined;
  }
  if (s.kind === 'line') {
    const d = sub(s.b, s.a);
    const t = ((p[0] - s.a[0]) * d[0] + (p[1] - s.a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2);
    const slack = tolerance / Math.hypot(d[0], d[1]);
    return t >= -slack && t <= 1 + slack ? Math.min(Math.max(t, 0), 1) : undefined;
  }
  const offset = normalizeAngle(angleOf(sub(p, s.c)) - s.t0);
  const sweep = s.t1 - s.t0;
  const slack = tolerance / s.r;
  if (offset <= sweep + slack) return s.t0 + Math.min(offset, sweep);
  if (offset >= 2 * Math.PI - slack) return s.t0;
  return undefined;
}

/** How far a point is from a line or circle, with a sign that changes when it crosses it. */
function sideOf(s: Exclude<Segment, Curve>, p: Vec2): number {
  if (s.kind === 'line') return cross(sub(s.b, s.a), sub(p, s.a)) / distance(s.a, s.b);
  return distance(p, s.c) - s.r;
}

/**
 * Where a free-form curve crosses a line, a circle or another curve: sign changes of the side it is
 * on, then bisection; against another curve (taken as a polyline), Newton's method on both.
 */
function curveIntersections(s: Curve, t: Segment): Vec2[] {
  const steps = 96;
  const found: Vec2[] = [];
  const sideAt = (other: Exclude<Segment, Curve>) => (u: number) => sideOf(other, curveAt(s.curve, u));
  const polyline = t.kind === 'curve' ? sampleCurve(t.curve, t.t0, t.t1, 0.01) : [];
  const sides = t.kind === 'curve' ? polyline.slice(1).map((q, i) => sideAt({ kind: 'line', a: polyline[i] as Vec2, b: q, source: '' })) : [sideAt(t)];
  for (const side of sides) {
    let u0 = s.t0;
    let f0 = side(u0);
    for (let k = 1; k <= steps; k++) {
      const u1 = s.t0 + ((s.t1 - s.t0) * k) / steps;
      const f1 = side(u1);
      if (Math.abs(f0) < tolerance) found.push(curveAt(s.curve, u0));
      else if (f0 * f1 < 0) {
        let [lo, hi, flo] = [u0, u1, f0];
        for (let i = 0; i < 60; i++) {
          const mid = (lo + hi) / 2;
          const fm = side(mid);
          if (flo * fm <= 0) hi = mid;
          else [lo, flo] = [mid, fm];
        }
        found.push(curveAt(s.curve, (lo + hi) / 2));
      }
      [u0, f0] = [u1, f1];
    }
    if (Math.abs(f0) < tolerance) found.push(curveAt(s.curve, u0));
  }
  return t.kind === 'curve' ? found.map((p) => meet(s, t, p)) : found;
}

/** Refines a crossing of two curves found on a polyline: Newton's method on both parameters. */
function meet(s: Curve, t: Curve, guess: Vec2): Vec2 {
  let u = closestParameter(s.curve, guess, s.t0, s.t1).t;
  let v = closestParameter(t.curve, guess, t.t0, t.t1).t;
  for (let i = 0; i < 20; i++) {
    const f = sub(curveAt(s.curve, u), curveAt(t.curve, v));
    if (Math.hypot(f[0], f[1]) < 1e-12) break;
    const du = curveDerivative(s.curve, u);
    const dv = curveDerivative(t.curve, v);
    // Solve [du, -dv] (Δu, Δv) = -f by Cramer's rule.
    const det = cross(du, [-dv[0], -dv[1]]);
    if (Math.abs(det) < 1e-15) break;
    const minus: Vec2 = [-f[0], -f[1]];
    u += cross(minus, [-dv[0], -dv[1]]) / det;
    v += cross(du, minus) / det;
  }
  return curveAt(s.curve, u);
}

function intersections(s: Segment, t: Segment): Vec2[] {
  if (s.kind === 'curve') return curveIntersections(s, t);
  if (t.kind === 'curve') return curveIntersections(t, s);
  if (s.kind === 'line' && t.kind === 'line') return lineLine(s.a, s.b, t.a, t.b);
  if (s.kind === 'arc' && t.kind === 'arc') return circleCircle(s.c, s.r, t.c, t.r);
  const [line, arc] = (s.kind === 'line' ? [s, t] : [t, s]) as [Extract<Segment, { kind: 'line' }>, Extract<Segment, { kind: 'arc' }>];
  return circleLine(arc.c, arc.r, line.a, line.b);
}

/** Splits every segment wherever another one crosses or touches it. */
type Box = readonly [number, number, number, number];

/** A box around a segment, a little larger (arcs: their whole circle; curves: everywhere, always tested). */
function boxOf(s: Segment): Box {
  const m = tolerance * 10;
  if (s.kind === 'line') return [Math.min(s.a[0], s.b[0]) - m, Math.min(s.a[1], s.b[1]) - m, Math.max(s.a[0], s.b[0]) + m, Math.max(s.a[1], s.b[1]) + m];
  if (s.kind === 'arc') return [s.c[0] - s.r - m, s.c[1] - s.r - m, s.c[0] + s.r + m, s.c[1] + s.r + m];
  return [-Infinity, -Infinity, Infinity, Infinity];
}

const boxesMeet = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function split(segments: Segment[]): Segment[] {
  const cuts = segments.map(() => [] as number[]);
  // Only segments whose boxes meet can cross: sketches with hundreds of separate holes stay fast (CAD-94).
  const boxes = segments.map(boxOf);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (!boxesMeet(boxes[i] as Box, boxes[j] as Box)) continue;
      const s = segments[i] as Segment;
      const t = segments[j] as Segment;
      for (const p of intersections(s, t)) {
        const ps = parameterOf(s, p);
        const pt = parameterOf(t, p);
        if (ps === undefined || pt === undefined) continue;
        (cuts[i] as number[]).push(ps);
        (cuts[j] as number[]).push(pt);
      }
    }
  }
  return segments.flatMap((s, i) => {
    const [lo, hi] = s.kind === 'line' ? [0, 1] : [s.t0, s.t1];
    const scaleOf = speedOf(s);
    const params = [lo, ...(cuts[i] as number[]).filter((p) => (p - lo) * scaleOf > tolerance && (hi - p) * scaleOf > tolerance).sort((a, b) => a - b), hi];
    const unique = params.filter((p, k) => k === 0 || (p - (params[k - 1] as number)) * scaleOf > tolerance);
    return unique.slice(1).map((end, k): Segment => {
      const begin = unique[k] as number;
      return s.kind === 'line'
        ? { ...s, a: [s.a[0] + begin * (s.b[0] - s.a[0]), s.a[1] + begin * (s.b[1] - s.a[1])], b: [s.a[0] + end * (s.b[0] - s.a[0]), s.a[1] + end * (s.b[1] - s.a[1])] }
        : { ...s, t0: begin, t1: end };
    });
  });
}

/** Builds the graph: vertices merged within tolerance, duplicate and dangling edges removed. */
function graph(segments: Segment[]): { vertices: Vec2[]; edges: Edge[] } {
  const vertices: Vec2[] = [];
  // Vertices by grid cell of the merge distance: a point is merged with one in its own or a neighbouring cell.
  const merge = tolerance * 10;
  const cells = new Map<string, number[]>();
  const cellOf = (p: Vec2) => [Math.floor(p[0] / merge), Math.floor(p[1] / merge)];
  const vertexOf = (p: Vec2): number => {
    const [cx, cy] = cellOf(p) as [number, number];
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++) {
        const found = cells.get(`${x},${y}`)?.find((i) => distance(vertices[i] as Vec2, p) < merge);
        if (found !== undefined) return found;
      }
    vertices.push(p);
    const key = `${cx},${cy}`;
    cells.set(key, [...(cells.get(key) ?? []), vertices.length - 1]);
    return vertices.length - 1;
  };
  let edges: Edge[] = [];
  const between = new Map<string, Edge[]>();
  for (const segment of segments) {
    const u = vertexOf(startOf(segment));
    const v = vertexOf(endOf(segment));
    if (u === v) continue;
    const pair = u < v ? `${u},${v}` : `${v},${u}`;
    const duplicate = (between.get(pair) ?? []).some((e) => {
      if (!((e.u === u && e.v === v) || (e.u === v && e.v === u))) return false;
      if (e.segment.kind !== segment.kind) return false;
      if (segment.kind === 'curve') return e.segment.kind === 'curve' && e.segment.source === segment.source && Math.abs(e.segment.t0 - segment.t0) < 1e-9;
      return segment.kind === 'line' || (e.segment.kind === 'arc' && distance(e.segment.c, segment.c) < tolerance && e.u === u);
    });
    if (duplicate) continue;
    const edge = { u, v, segment };
    edges.push(edge);
    between.set(pair, [...(between.get(pair) ?? []), edge]);
  }
  for (let pruned = true; pruned; ) {
    const degree = new Map<number, number>();
    for (const e of edges) {
      degree.set(e.u, (degree.get(e.u) ?? 0) + 1);
      degree.set(e.v, (degree.get(e.v) ?? 0) + 1);
    }
    const kept = edges.filter((e) => (degree.get(e.u) ?? 0) > 1 && (degree.get(e.v) ?? 0) > 1);
    pruned = kept.length < edges.length;
    edges = kept;
  }
  return { vertices, edges };
}

function halfEdge(edge: Edge, forward: boolean): HalfEdge {
  const s = edge.segment;
  let direction: Vec2;
  let curvature = 0;
  if (s.kind === 'line') {
    direction = forward ? sub(s.b, s.a) : sub(s.a, s.b);
  } else if (s.kind === 'curve') {
    const t = forward ? s.t0 : s.t1;
    const d1 = curveDerivative(s.curve, t);
    const d2 = curveSecondDerivative(s.curve, t);
    direction = forward ? d1 : [-d1[0], -d1[1]];
    curvature = ((forward ? 1 : -1) * cross(d1, d2)) / Math.max(Math.hypot(d1[0], d1[1]) ** 3, 1e-30);
  } else {
    const t = forward ? s.t0 : s.t1;
    direction = forward ? [-Math.sin(t), Math.cos(t)] : [Math.sin(t), -Math.cos(t)];
    curvature = (forward ? 1 : -1) / s.r;
  }
  return { edge, forward, from: forward ? edge.u : edge.v, to: forward ? edge.v : edge.u, angle: normalizeAngle(angleOf(direction)), curvature };
}

/** Points along a half-edge, excluding its end point. */
function samples(h: HalfEdge): Vec2[] {
  const s = h.edge.segment;
  if (s.kind === 'line') return [h.forward ? s.a : s.b];
  if (s.kind === 'curve') return sampleCurve(s.curve, h.forward ? s.t0 : s.t1, h.forward ? s.t1 : s.t0, 0.01).slice(0, -1);
  const steps = Math.max(2, Math.ceil((s.t1 - s.t0) / maxArcStep));
  return Array.from({ length: steps }, (_, i) => {
    const k = h.forward ? i / steps : 1 - i / steps;
    return polar(s.c, s.r, s.t0 + k * (s.t1 - s.t0));
  });
}

function toProfileEdge(h: HalfEdge, vertices: Vec2[]): ProfileEdge {
  const s = h.edge.segment;
  const start = vertices[h.from] as Vec2;
  const end = vertices[h.to] as Vec2;
  if (s.kind === 'line') return { kind: 'line', start, end, source: s.source };
  if (s.kind === 'arc') return { kind: 'arc', source: s.source, start, end, center: s.c, radius: s.r, ccw: h.forward };
  if (s.curve.kind === 'ellipse') {
    const { center, a, b, rotation } = s.curve.ellipse;
    return { kind: 'ellipse', source: s.source, start, end, center, a, b, rotation, ccw: h.forward };
  }
  const piece = splitBezier(s.curve.points, s.t0, s.t1);
  const [c1, c2] = h.forward ? [piece[1], piece[2]] : [piece[2], piece[1]];
  return { kind: 'bezier', source: s.source, start, end, c1, c2 };
}

/** Exact signed area: polygon of the vertices plus the circular segment each arc adds or removes. */
function loopArea(loop: HalfEdge[], vertices: Vec2[]): number {
  let area = signedArea(loop.map((h) => vertices[h.from] as Vec2));
  for (const h of loop) {
    const s = h.edge.segment;
    if (s.kind === 'curve') {
      // The curve's own share of the area, less its chord's, which the polygon already holds.
      const [p, q] = [startOf(s), endOf(s)];
      area += (h.forward ? 1 : -1) * (curveArea(s.curve, s.t0, s.t1) - (p[0] * q[1] - q[0] * p[1]) / 2);
      continue;
    }
    if (s.kind !== 'arc') continue;
    const sweep = s.t1 - s.t0;
    area += ((h.forward ? 1 : -1) * s.r * s.r * (sweep - Math.sin(sweep))) / 2;
  }
  return area;
}

function faces(edges: Edge[]): HalfEdge[][] {
  const halfEdges = edges.flatMap((e) => [halfEdge(e, true), halfEdge(e, false)]);
  const outgoing = new Map<number, HalfEdge[]>();
  for (const h of halfEdges) outgoing.set(h.from, [...(outgoing.get(h.from) ?? []), h]);
  for (const list of outgoing.values()) {
    list.sort((a, b) => (Math.abs(a.angle - b.angle) > 1e-9 ? a.angle - b.angle : a.curvature - b.curvature));
  }
  const backward = new Map(halfEdges.filter((h) => !h.forward).map((h) => [h.edge, h]));
  const forward = new Map(halfEdges.filter((h) => h.forward).map((h) => [h.edge, h]));
  const twin = (h: HalfEdge) => (h.forward ? backward : forward).get(h.edge) as HalfEdge;
  // Turning as far right as possible keeps each traced face on the left of its edges.
  const next = (h: HalfEdge): HalfEdge => {
    const around = outgoing.get(h.to) as HalfEdge[];
    const index = around.indexOf(twin(h));
    return around[(index - 1 + around.length) % around.length] as HalfEdge;
  };
  const visited = new Set<HalfEdge>();
  const result: HalfEdge[][] = [];
  for (const start of halfEdges) {
    if (visited.has(start)) continue;
    const loop: HalfEdge[] = [];
    for (let h = start; !visited.has(h) && loop.length <= halfEdges.length; h = next(h)) {
      visited.add(h);
      loop.push(h);
    }
    result.push(loop);
  }
  return result;
}

function components(edges: Edge[]): (vertex: number) => number {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const e of edges) parent.set(find(e.u), find(e.v));
  return find;
}

export function findProfiles(sketch: Sketch, texts: TextOutlines = new Map()): Profile[] {
  const { vertices, edges } = graph(split(segmentsOf(sketch, texts)));
  if (edges.length === 0) return [];
  const componentOf = components(edges);
  const traced = faces(edges).map((loop) => {
    const polygon = loop.flatMap(samples);
    const box = polygon.reduce((b, p): Box => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity] as Box);
    return { loop, area: loopArea(loop, vertices), polygon, box, component: componentOf((loop[0] as HalfEdge).from) };
  });
  const bounded = traced.filter((f) => f.area > tolerance);
  const boundaries = traced.filter((f) => f.area < -tolerance);
  const holes = new Map<(typeof bounded)[number], typeof boundaries>();
  for (const boundary of boundaries) {
    const probe = vertices[(boundary.loop[0] as HalfEdge).from] as Vec2;
    const around = bounded
      .filter((f) => f.component !== boundary.component && boxesMeet(f.box, [probe[0], probe[1], probe[0], probe[1]]) && containsPoint(f.polygon, probe))
      .sort((a, b) => a.area - b.area)[0];
    if (around) holes.set(around, [...(holes.get(around) ?? []), boundary]);
  }
  const toLoop = (f: (typeof traced)[number]): ProfileLoop => ({
    edges: f.loop.map((h) => toProfileEdge(h, vertices)),
    polygon: f.polygon,
  });
  const profiles = bounded.map((face) => {
    const inner = holes.get(face) ?? [];
    const sources = [...new Set([face, ...inner].flatMap((f) => f.loop.map((h) => h.edge.segment.source)))].sort();
    const centroid = face.polygon.reduce((c, p) => [c[0] + p[0] / face.polygon.length, c[1] + p[1] / face.polygon.length] as Vec2, [0, 0] as Vec2);
    return {
      key: contentHash(sources),
      centroid,
      profile: {
        outer: toLoop(face),
        holes: inner.map(toLoop),
        area: face.area + inner.reduce((sum, h) => sum + h.area, 0),
      },
    };
  });
  // Regions bounded by the same curves (e.g. two halves of a split circle) are told apart by position.
  profiles.sort((a, b) => a.key.localeCompare(b.key) || a.centroid[0] - b.centroid[0] || a.centroid[1] - b.centroid[1]);
  return profiles.map((p): Profile => {
    const same = profiles.filter((q) => q.key === p.key);
    const id = same.length > 1 ? `${p.key}-${same.indexOf(p) + 1}` : p.key;
    return { id, ...p.profile };
  });
}
