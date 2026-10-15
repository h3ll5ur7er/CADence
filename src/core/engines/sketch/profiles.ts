import { type Profile, type ProfileEdge, type ProfileLoop, type Sketch, sketchOriginId } from '@core/contracts';
import { contentHash } from '@core/utilities/identity';
import {
  angleOf,
  ccwSweep,
  containsPoint,
  cross,
  distance,
  normalizeAngle,
  polar,
  signedArea,
  sub,
  type Vec2,
} from '@core/utilities/math';

/**
 * Finds the closed regions of a sketch: non-construction curves are split at their intersections,
 * the resulting planar graph is walked face by face, and islands become holes of the smallest face
 * around them.
 */

const tolerance = 1e-6;
const maxArcStep = (2 * Math.PI) / 180;

type Segment =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2; readonly source: string }
  | { readonly kind: 'arc'; readonly c: Vec2; readonly r: number; readonly t0: number; readonly t1: number; readonly source: string };

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

const startOf = (s: Segment): Vec2 => (s.kind === 'line' ? s.a : polar(s.c, s.r, s.t0));
const endOf = (s: Segment): Vec2 => (s.kind === 'line' ? s.b : polar(s.c, s.r, s.t1));

function segmentsOf(sketch: Sketch): Segment[] {
  const points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const segments: Segment[] = [];
  for (const e of sketch.entities) {
    if (e.kind === 'point' || e.construction) continue;
    if (e.kind === 'line') {
      segments.push({ kind: 'line', a: at(e.start), b: at(e.end), source: e.id });
    } else if (e.kind === 'circle') {
      const c = at(e.center);
      segments.push({ kind: 'arc', c, r: e.radius, t0: 0, t1: Math.PI, source: e.id });
      segments.push({ kind: 'arc', c, r: e.radius, t0: Math.PI, t1: 2 * Math.PI, source: e.id });
    } else {
      const c = at(e.center);
      const t0 = angleOf(sub(at(e.start), c));
      segments.push({ kind: 'arc', c, r: distance(at(e.start), c), t0, t1: t0 + ccwSweep(t0, angleOf(sub(at(e.end), c))), source: e.id });
    }
  }
  return segments.filter((s) => (s.kind === 'line' ? distance(s.a, s.b) > tolerance : s.r > tolerance));
}

/** Parameter of a point known to lie on the segment's carrier (line t ∈ [0,1], arc angle ∈ [t0,t1]). */
function parameterOf(s: Segment, p: Vec2): number | undefined {
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

function circleLine(c: Vec2, r: number, a: Vec2, b: Vec2): Vec2[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = d[0] ** 2 + d[1] ** 2;
  const B = 2 * (f[0] * d[0] + f[1] * d[1]);
  const C = f[0] ** 2 + f[1] ** 2 - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < -tolerance) return [];
  const root = Math.sqrt(Math.max(disc, 0));
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)].map((t) => [a[0] + t * d[0], a[1] + t * d[1]] as Vec2);
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = distance(c1, c2);
  if (d < tolerance || d > r1 + r2 + tolerance || d < Math.abs(r1 - r2) - tolerance) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const m: Vec2 = [c1[0] + (a * (c2[0] - c1[0])) / d, c1[1] + (a * (c2[1] - c1[1])) / d];
  const o: Vec2 = [(h * (c2[1] - c1[1])) / d, (-h * (c2[0] - c1[0])) / d];
  return [
    [m[0] + o[0], m[1] + o[1]],
    [m[0] - o[0], m[1] - o[1]],
  ];
}

function intersections(s: Segment, t: Segment): Vec2[] {
  if (s.kind === 'line' && t.kind === 'line') {
    const r = sub(s.b, s.a);
    const q = sub(t.b, t.a);
    const denominator = cross(r, q);
    if (Math.abs(denominator) < 1e-12) return [];
    const u = cross(sub(t.a, s.a), q) / denominator;
    return [[s.a[0] + u * r[0], s.a[1] + u * r[1]]];
  }
  if (s.kind === 'arc' && t.kind === 'arc') return circleCircle(s.c, s.r, t.c, t.r);
  const [line, arc] = (s.kind === 'line' ? [s, t] : [t, s]) as [Extract<Segment, { kind: 'line' }>, Extract<Segment, { kind: 'arc' }>];
  return circleLine(arc.c, arc.r, line.a, line.b);
}

/** Splits every segment wherever another one crosses or touches it. */
function split(segments: Segment[]): Segment[] {
  const cuts = segments.map(() => [] as number[]);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
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
    const scaleOf = s.kind === 'line' ? distance(s.a, s.b) : s.r;
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
  const vertexOf = (p: Vec2): number => {
    const found = vertices.findIndex((v) => distance(v, p) < tolerance * 10);
    if (found >= 0) return found;
    vertices.push(p);
    return vertices.length - 1;
  };
  let edges: Edge[] = [];
  for (const segment of segments) {
    const u = vertexOf(startOf(segment));
    const v = vertexOf(endOf(segment));
    if (u === v) continue;
    const duplicate = edges.some((e) => {
      if (!((e.u === u && e.v === v) || (e.u === v && e.v === u))) return false;
      if (e.segment.kind !== segment.kind) return false;
      return segment.kind === 'line' || (e.segment.kind === 'arc' && distance(e.segment.c, segment.c) < tolerance && e.u === u);
    });
    if (!duplicate) edges.push({ u, v, segment });
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
  return { kind: 'arc', source: s.source, start, end, center: s.c, radius: s.r, ccw: h.forward };
}

/** Exact signed area: polygon of the vertices plus the circular segment each arc adds or removes. */
function loopArea(loop: HalfEdge[], vertices: Vec2[]): number {
  let area = signedArea(loop.map((h) => vertices[h.from] as Vec2));
  for (const h of loop) {
    const s = h.edge.segment;
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
  const twin = (h: HalfEdge) => halfEdges.find((o) => o.edge === h.edge && o.forward !== h.forward) as HalfEdge;
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

export function findProfiles(sketch: Sketch): Profile[] {
  const { vertices, edges } = graph(split(segmentsOf(sketch)));
  if (edges.length === 0) return [];
  const componentOf = components(edges);
  const traced = faces(edges).map((loop) => ({
    loop,
    area: loopArea(loop, vertices),
    polygon: loop.flatMap(samples),
    component: componentOf((loop[0] as HalfEdge).from),
  }));
  const bounded = traced.filter((f) => f.area > tolerance);
  const boundaries = traced.filter((f) => f.area < -tolerance);
  const holes = new Map<(typeof bounded)[number], typeof boundaries>();
  for (const boundary of boundaries) {
    const probe = vertices[(boundary.loop[0] as HalfEdge).from] as Vec2;
    const around = bounded
      .filter((f) => f.component !== boundary.component && containsPoint(f.polygon, probe))
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
