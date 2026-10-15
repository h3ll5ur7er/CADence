import { fail, isCurve, ok, type Result, type Sketch, sketchOriginId, type Vec2 } from '@core/contracts';
import { angleOf, ccwSweep, curveAt, distance, splineBeziers, sub } from '@core/utilities/math';

/** A piece of a path in sketch coordinates: a line, an arc through `mid`, or a cubic Bézier. */
export type PathPiece2 =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'arc'; readonly start: Vec2; readonly mid: Vec2; readonly end: Vec2 }
  | { readonly kind: 'bezier'; readonly points: readonly [Vec2, Vec2, Vec2, Vec2] };

export interface SketchPath {
  /** In order along the path, each starting where the one before ends. */
  readonly pieces: readonly PathPiece2[];
  readonly closed: boolean;
}

const startOf = (p: PathPiece2): Vec2 => (p.kind === 'bezier' ? p.points[0] : p.start);
const endOf = (p: PathPiece2): Vec2 => (p.kind === 'bezier' ? p.points[3] : p.end);
const reversed = (p: PathPiece2): PathPiece2 =>
  p.kind === 'bezier' ? { kind: 'bezier', points: [p.points[3], p.points[2], p.points[1], p.points[0]] } : { ...p, start: p.end, end: p.start };

/**
 * The sketch's curves (not construction geometry) as one path: a chain of lines, arcs, circles and
 * splines joined end to end, open or closed.
 */
export function sketchPath(sketch: Sketch): Result<SketchPath> {
  const points = new Map<string, Vec2>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const pieces: PathPiece2[] = [];
  for (const e of sketch.entities) {
    if (!isCurve(e) || e.construction) continue;
    switch (e.kind) {
      case 'line':
        pieces.push({ kind: 'line', start: at(e.start), end: at(e.end) });
        break;
      case 'arc': {
        const c = at(e.center);
        const [s, t] = [at(e.start), at(e.end)];
        const a0 = angleOf(sub(s, c));
        const mid = a0 + ccwSweep(a0, angleOf(sub(t, c))) / 2;
        const r = distance(s, c);
        pieces.push({ kind: 'arc', start: s, mid: [c[0] + r * Math.cos(mid), c[1] + r * Math.sin(mid)], end: t });
        break;
      }
      case 'circle': {
        const c = at(e.center);
        const p = (a: number): Vec2 => [c[0] + e.radius * Math.cos(a), c[1] + e.radius * Math.sin(a)];
        pieces.push({ kind: 'arc', start: p(0), mid: p(Math.PI / 2), end: p(Math.PI) }, { kind: 'arc', start: p(Math.PI), mid: p((3 * Math.PI) / 2), end: p(0) });
        break;
      }
      case 'spline':
        for (const points of splineBeziers(e.points.map(at), e.closed)) pieces.push({ kind: 'bezier', points: points as unknown as [Vec2, Vec2, Vec2, Vec2] });
        break;
      default:
        return fail({ code: 'invalid-input', message: 'Paths are made of lines, arcs, circles and splines.' });
    }
  }
  if (!pieces.length) return fail({ code: 'missing-input', message: 'The path sketch has no curves.' });
  // Chain the pieces: start at an end that no other piece continues, or anywhere on a loop.
  const meets = (a: Vec2, b: Vec2) => distance(a, b) < 1e-6;
  const ends = pieces.flatMap((p) => [startOf(p), endOf(p)]);
  const lone = ends.find((p) => ends.filter((q) => meets(p, q)).length === 1);
  const rest = [...pieces];
  const first = rest.findIndex((p) => !lone || meets(startOf(p), lone) || meets(endOf(p), lone));
  let piece = rest.splice(first, 1)[0] as PathPiece2;
  if (lone && !meets(startOf(piece), lone)) piece = reversed(piece);
  const chain = [piece];
  while (rest.length) {
    const tip = endOf(chain[chain.length - 1] as PathPiece2);
    const next = rest.findIndex((p) => meets(startOf(p), tip) || meets(endOf(p), tip));
    if (next < 0) return fail({ code: 'invalid-input', message: 'The path has to be one chain of curves, joined end to end.' });
    const found = rest.splice(next, 1)[0] as PathPiece2;
    chain.push(meets(startOf(found), tip) ? found : reversed(found));
  }
  return ok({ pieces: chain, closed: !lone && meets(endOf(chain[chain.length - 1] as PathPiece2), startOf(chain[0] as PathPiece2)) });
}

/** A piece as a polyline of `n` segments. */
function sample(piece: PathPiece2, n: number): Vec2[] {
  if (piece.kind === 'line') return [piece.start, piece.end];
  if (piece.kind === 'bezier') return Array.from({ length: n + 1 }, (_, i) => curveAt({ kind: 'bezier', points: piece.points }, i / n));
  // The circle through the three points, swept from start through mid to end.
  const [a, b, c] = [piece.start, piece.mid, piece.end];
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const sq = (p: Vec2) => p[0] * p[0] + p[1] * p[1];
  const center: Vec2 = [(sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d, (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d];
  const r = distance(a, center);
  const [t0, tm, t1] = [a, b, c].map((p) => angleOf(sub(p, center))) as [number, number, number];
  const ccw = ccwSweep(t0, tm) < ccwSweep(t0, t1);
  const sweep = ccw ? ccwSweep(t0, t1) : -ccwSweep(t1, t0);
  return Array.from({ length: n + 1 }, (_, i) => [center[0] + r * Math.cos(t0 + (sweep * i) / n), center[1] + r * Math.sin(t0 + (sweep * i) / n)] as Vec2);
}

/**
 * `count` places spaced evenly along the path by length, with the direction of travel there: from
 * start to end on an open path, around and short of the start again on a closed one.
 */
export function placesAlong(path: SketchPath, count: number): { readonly point: Vec2; readonly direction: Vec2 }[] {
  const polyline = path.pieces.flatMap((p, i) => sample(p, 64).slice(i === 0 ? 0 : 1));
  const lengths = [0];
  for (let i = 1; i < polyline.length; i++) lengths.push((lengths[i - 1] as number) + distance(polyline[i - 1] as Vec2, polyline[i] as Vec2));
  const total = lengths[lengths.length - 1] as number;
  const step = total / (path.closed ? count : Math.max(count - 1, 1));
  return Array.from({ length: count }, (_, k) => {
    const target = Math.min(step * k, total);
    const i = Math.max(1, lengths.findIndex((l) => l >= target - 1e-12));
    const [p, q] = [polyline[i - 1] as Vec2, polyline[i] as Vec2];
    const span = (lengths[i] as number) - (lengths[i - 1] as number) || 1;
    const t = (target - (lengths[i - 1] as number)) / span;
    const d = sub(q, p);
    const length = Math.hypot(d[0], d[1]) || 1;
    return { point: [p[0] + d[0] * t, p[1] + d[1] * t], direction: [d[0] / length, d[1] / length] };
  });
}
