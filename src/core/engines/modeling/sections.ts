import type { PlaneFrame, ProfileEdge, ProfileLoop, Vec2, Vec3 } from '@core/contracts';
import { ccwSweep, curveAt, ellipseParameter } from '@core/utilities/math';
import { add3, dot3, length3, normalOf, scale3, sub3, toWorld } from './geometry';

/**
 * Sections lined up for a loft (CAD-106). OpenCascade's own matching picks each wire's start by the
 * nearest vertex, and a loft from a circle into airfoils twisted half a turn and pinched. Instead,
 * each section after the first runs the same way round as the one before it and starts where it fits
 * that one best; then all sections get the same number of edges, split at matching places along them,
 * so the loft joins them vertex to vertex (with the kernel's matching off).
 */
export function alignSections(sections: readonly { readonly frame: PlaneFrame; readonly loop: ProfileLoop }[]): ProfileLoop[] {
  const aligned: ProfileLoop[] = [];
  let previous: Vec3[] | undefined;
  let previousNormal: Vec3 | undefined;
  for (const { frame, loop } of sections) {
    const normal = loopNormal(loop, frame);
    const same = !previousNormal || dot3(normal, previousNormal) >= 0;
    let best = same ? loop : reversed(loop);
    if (previous) {
      const target = previous;
      let score = Infinity;
      for (const candidate of starts(best)) {
        const fit = mismatch(target, samples(candidate, frame));
        if (fit < score - 1e-9) [score, best] = [fit, candidate];
      }
    }
    aligned.push(best);
    previous = samples(best, frame);
    previousNormal = same ? normal : scale3(normal, -1);
  }
  return equalEdgeCounts(aligned);
}

const sampleCount = 48;
/** Loops with fewer edges (circles, rectangles) may also start part way along an edge. */
const fewEdges = 8;

/** Where each edge starts along the loop, as a fraction of its length (the first at 0). */
function vertexFractions(loop: ProfileLoop): number[] {
  const lengths = loop.edges.map(approximateLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let before = 0;
  return lengths.map((length) => {
    const fraction = before / total;
    before += length;
    return fraction;
  });
}

/**
 * Splits edges so every loop has as many as the one with the most, with its new vertices where the
 * nearest such loop has its vertices along its length.
 */
function equalEdgeCounts(loops: readonly ProfileLoop[]): ProfileLoop[] {
  const most = Math.max(...loops.map((l) => l.edges.length));
  const full = loops.flatMap((l, i) => (l.edges.length === most ? [i] : []));
  return loops.map((loop, i) => {
    if (loop.edges.length === most) return loop;
    const reference = full.reduce((a, b) => (Math.abs(b - i) < Math.abs(a - i) ? b : a));
    return splitTo(loop, vertexFractions(loops[reference] as ProfileLoop));
  });
}

/** The loop with extra vertices at the target fractions its own vertices do not take. */
function splitTo(loop: ProfileLoop, targets: readonly number[]): ProfileLoop {
  const own = vertexFractions(loop);
  const taken = matchInOrder(own, targets);
  const extra = targets.filter((_, k) => !taken.has(k));
  const lengths = loop.edges.map(approximateLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const edges = loop.edges.flatMap((edge, j) => {
    const [from, to] = [own[j] as number, j + 1 < own.length ? (own[j + 1] as number) : 1];
    const inside = extra.filter((f) => f > from && f < to).map((f) => ((f - from) * total) / ((lengths[j] as number) || 1));
    return splitAt(edge, inside);
  });
  return { ...loop, edges };
}

/** Which target each own fraction takes, in order and one each, as close as can be (dynamic programming). */
function matchInOrder(own: readonly number[], targets: readonly number[]): Set<number> {
  const [n, m] = [own.length, targets.length];
  const cost = Array.from({ length: n + 1 }, (_, j) => new Array<number>(m + 1).fill(j === 0 ? 0 : Infinity));
  const at = (j: number, k: number) => (cost[j] as number[])[k] as number;
  const take = (j: number, k: number) => at(j - 1, k - 1) + Math.abs((own[j - 1] as number) - (targets[k - 1] as number));
  for (let j = 1; j <= n; j++) for (let k = j; k <= m; k++) (cost[j] as number[])[k] = Math.min(at(j, k - 1), take(j, k));
  const taken = new Set<number>();
  for (let j = n, k = m; j > 0; k--) {
    if (Math.abs(at(j, k) - take(j, k)) < 1e-12) {
      taken.add(k - 1);
      j--;
    }
  }
  return taken;
}

/** The loop's points from its start, evenly along its length, in world coordinates. */
function samples(loop: ProfileLoop, frame: PlaneFrame): Vec3[] {
  const lengths = loop.edges.map(approximateLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const points: Vec3[] = [];
  let edge = 0;
  let before = 0;
  for (let i = 0; i < sampleCount; i++) {
    const at = (i / sampleCount) * total;
    while (edge < loop.edges.length - 1 && before + (lengths[edge] as number) < at) before += lengths[edge++] as number;
    const t = Math.min(1, (at - before) / ((lengths[edge] as number) || 1));
    points.push(toWorld(frame, pointAt(loop.edges[edge] as ProfileEdge, t)));
  }
  return points;
}

/** How far apart two sections' samples are, each about its own centre and in its own size. */
function mismatch(a: readonly Vec3[], b: readonly Vec3[]): number {
  const [na, nb] = [normalised(a), normalised(b)];
  return na.reduce((sum, p, i) => sum + length3(sub3(p, nb[i] as Vec3)) ** 2, 0);
}

function normalised(points: readonly Vec3[]): Vec3[] {
  const centre = scale3(points.reduce(add3, [0, 0, 0] as Vec3), 1 / points.length);
  const relative = points.map((p) => sub3(p, centre));
  const size = Math.sqrt(relative.reduce((sum, p) => sum + dot3(p, p), 0) / points.length) || 1;
  return relative.map((p) => scale3(p, 1 / size));
}

/** The loop's normal by its winding, in world coordinates. */
function loopNormal(loop: ProfileLoop, frame: PlaneFrame): Vec3 {
  const points = loop.edges.flatMap((edge) => [0, 0.25, 0.5, 0.75].map((t) => pointAt(edge, t)));
  let area = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as Vec2;
    area += p[0] * q[1] - q[0] * p[1];
  });
  return scale3(normalOf(frame), Math.sign(area) || 1);
}

/** Every way the loop can start: at each vertex, and for loops of few edges part way along them. */
function starts(loop: ProfileLoop): ProfileLoop[] {
  const n = loop.edges.length;
  const rotated = (i: number, edges: readonly ProfileEdge[]) => ({ ...loop, edges: [...edges.slice(i), ...edges.slice(0, i)] });
  const result = loop.edges.map((_, i) => rotated(i, loop.edges));
  if (n >= fewEdges) return result;
  for (let i = 0; i < n; i++) {
    const edge = loop.edges[i] as ProfileEdge;
    for (const t of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const edges = [...loop.edges.slice(0, i), ...splitAt(edge, [t]), ...loop.edges.slice(i + 1)];
      result.push(rotated(i + 1, edges));
    }
  }
  return result;
}

/** An edge in pieces at the parameters (0 … 1, increasing). */
function splitAt(edge: ProfileEdge, at: readonly number[]): ProfileEdge[] {
  const pieces: ProfileEdge[] = [];
  let rest = edge;
  let done = 0;
  for (const t of at) {
    const [head, tail] = split(rest, (t - done) / (1 - done));
    pieces.push(head);
    [rest, done] = [tail, t];
  }
  return [...pieces, rest];
}

/** An edge in two at parameter t. */
function split(edge: ProfileEdge, t: number): [ProfileEdge, ProfileEdge] {
  if (edge.kind === 'bezier') {
    // De Casteljau.
    const lerp = (a: Vec2, b: Vec2): Vec2 => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const [ab, bc, cd] = [lerp(edge.start, edge.c1), lerp(edge.c1, edge.c2), lerp(edge.c2, edge.end)];
    const [abc, bcd] = [lerp(ab, bc), lerp(bc, cd)];
    const middle = lerp(abc, bcd);
    return [
      { ...edge, end: middle, c1: ab, c2: abc },
      { ...edge, start: middle, c1: bcd, c2: cd },
    ];
  }
  const middle = pointAt(edge, t);
  return [
    { ...edge, end: middle },
    { ...edge, start: middle },
  ];
}

/** The loop run the other way round. */
function reversed(loop: ProfileLoop): ProfileLoop {
  const edges = [...loop.edges].reverse().map((edge): ProfileEdge => {
    if (edge.kind === 'bezier') return { ...edge, start: edge.end, end: edge.start, c1: edge.c2, c2: edge.c1 };
    if (edge.kind === 'line') return { ...edge, start: edge.end, end: edge.start };
    return { ...edge, start: edge.end, end: edge.start, ccw: !edge.ccw };
  });
  return { edges, polygon: [...loop.polygon].reverse() };
}

function approximateLength(edge: ProfileEdge): number {
  let length = 0;
  let last = edge.start;
  for (let i = 1; i <= 8; i++) {
    const p = pointAt(edge, i / 8);
    length += Math.hypot(p[0] - last[0], p[1] - last[1]);
    last = p;
  }
  return length;
}

/** The point at parameter t (0 … 1) along a profile edge. */
function pointAt(edge: ProfileEdge, t: number): Vec2 {
  switch (edge.kind) {
    case 'line':
      return [edge.start[0] + t * (edge.end[0] - edge.start[0]), edge.start[1] + t * (edge.end[1] - edge.start[1])];
    case 'arc': {
      const a0 = Math.atan2(edge.start[1] - edge.center[1], edge.start[0] - edge.center[0]);
      const a1 = Math.atan2(edge.end[1] - edge.center[1], edge.end[0] - edge.center[0]);
      const a = a0 + t * (edge.ccw ? ccwSweep(a0, a1) : -ccwSweep(a1, a0));
      return [edge.center[0] + edge.radius * Math.cos(a), edge.center[1] + edge.radius * Math.sin(a)];
    }
    case 'bezier':
      return curveAt({ kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] }, t);
    case 'ellipse': {
      const ellipse = { center: edge.center, a: edge.a, b: edge.b, rotation: edge.rotation };
      const t0 = ellipseParameter(ellipse, edge.start);
      const t1 = ellipseParameter(ellipse, edge.end);
      return curveAt({ kind: 'ellipse', ellipse }, t0 + t * (edge.ccw ? ccwSweep(t0, t1) : -ccwSweep(t1, t0)));
    }
  }
}
