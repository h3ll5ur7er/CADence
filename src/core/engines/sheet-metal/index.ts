import { fail, type FlangeMarker, ok, type PlaneFrame, type Profile, type ProfileEdge, type Result, type Vec2, type Vec3 } from '@core/contracts';

/** The sheet's rules: thickness, inside bend radius and K-factor (where the neutral layer lies, 0 to 1). */
export interface SheetMetalRules {
  readonly thickness: number;
  readonly bendRadius: number;
  readonly kFactor: number;
}

/** The flat pattern in the base flange's sketch plane: outlines to cut, and bend lines to mark. */
export interface FlatPattern {
  readonly cuts: readonly ProfileEdge[];
  readonly bends: readonly ProfileEdge[];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const close = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

/** How much flat length a bend takes: the length of the neutral layer through it. */
export const bendAllowance = (angle: number, rules: SheetMetalRules): number => angle * (rules.bendRadius + rules.kFactor * rules.thickness);

/**
 * Unfolds a sheet: the base flange's outlines, with each edge flange laid flat beyond its edge (the
 * bend allowance, then the flange), and a bend line through the middle of each bend. Flanges must
 * stand on straight edges of the base flange.
 */
export function flatPattern(frame: PlaneFrame, profiles: readonly Profile[], flanges: readonly FlangeMarker[], rules: SheetMetalRules): Result<FlatPattern> {
  const normal = cross(frame.u, frame.v);
  const flat = (p: Vec3): Vec2 => {
    const d = sub(p, frame.origin);
    return [dot(d, frame.u), dot(d, frame.v)];
  };
  let cuts: ProfileEdge[] = profiles.flatMap((p) => [p.outer, ...p.holes].flatMap((loop) => loop.edges)).map((e) => ({ ...e, source: 'cut' }));
  const bends: ProfileEdge[] = [];
  for (const flange of flanges) {
    if (Math.abs(dot(flange.away, normal)) > 1e-6) return fail({ code: 'not-unfoldable', message: 'Only flanges on edges of the base flange can be unfolded.' });
    const [s, e] = [flange.start, flange.end].map(flat) as [Vec2, Vec2];
    const away: Vec2 = [dot(flange.away, frame.u), dot(flange.away, frame.v)];
    // The base outline edge the flange stands on is replaced where they overlap.
    const index = cuts.findIndex((c) => c.kind === 'line' && onLine(s, c.start, c.end) && onLine(e, c.start, c.end));
    const edge = cuts[index];
    if (!edge || edge.kind !== 'line') return fail({ code: 'not-unfoldable', message: 'A flange does not stand on a straight edge of the base flange.' });
    const allowance = bendAllowance(flange.angle, rules);
    const width = allowance + flange.length;
    const out = (p: Vec2, d: number): Vec2 => [p[0] + away[0] * d, p[1] + away[1] * d];
    // Keep what is left of the outline edge on either side of the flange, in the edge's direction.
    const [first, last] = along(edge.start, edge.end, s) <= along(edge.start, edge.end, e) ? [s, e] : [e, s];
    const rest: ProfileEdge[] = [];
    if (!close(edge.start, first)) rest.push({ kind: 'line', start: edge.start, end: first, source: 'cut' });
    rest.push(
      { kind: 'line', start: first, end: out(first, width), source: 'cut' },
      { kind: 'line', start: out(first, width), end: out(last, width), source: 'cut' },
      { kind: 'line', start: out(last, width), end: last, source: 'cut' },
    );
    if (!close(last, edge.end)) rest.push({ kind: 'line', start: last, end: edge.end, source: 'cut' });
    cuts = [...cuts.slice(0, index), ...rest, ...cuts.slice(index + 1)];
    bends.push({ kind: 'line', start: out(first, allowance / 2), end: out(last, allowance / 2), source: 'bend' });
  }
  return ok({ cuts, bends });
}

/** Where `p` lies along the segment from `a` to `b` (0 at a, 1 at b). */
function along(a: Vec2, b: Vec2, p: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  return ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
}

/** Whether `p` lies on the segment from `a` to `b`. */
function onLine(p: Vec2, a: Vec2, b: Vec2): boolean {
  const t = along(a, b, p);
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const off = Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / Math.hypot(d[0], d[1]);
  return t > -1e-6 && t < 1 + 1e-6 && off < 1e-5;
}
