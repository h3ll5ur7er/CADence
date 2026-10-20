import { type CornerRelief, fail, flangeCorners, type FlangeMarker, ok, type PlaneFrame, type Profile, type ProfileEdge, type Result, type Vec2, type Vec3 } from '@core/contracts';
import { bendLength, flangeSection, neutralAway } from '@core/utilities/math';

/** The sheet's rules: thickness, inside bend radius, K-factor (where the neutral layer lies, 0 to 1) and the corner relief. */
export interface SheetMetalRules {
  readonly thickness: number;
  readonly bendRadius: number;
  readonly kFactor: number;
  readonly relief?: { readonly shape: CornerRelief; readonly size: number };
}

/** The flat pattern in the base flange's sketch plane: outlines to cut, and bend lines to mark. */
export interface FlatPattern {
  readonly cuts: readonly ProfileEdge[];
  readonly bends: readonly ProfileEdge[];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const along2 = (p: Vec2, d: Vec2, s: number): Vec2 => [p[0] + d[0] * s, p[1] + d[1] * s];
const close = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
const unit2 = (v: Vec2): Vec2 => {
  const n = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / n, v[1] / n];
};
const line = (start: Vec2, end: Vec2, source = 'cut'): ProfileEdge => ({ kind: 'line', start, end, source });

/** How much flat length a bend of the sheet's radius takes: the length of the neutral layer through it. */
export const bendAllowance = (angle: number, rules: SheetMetalRules): number => bendLength(angle, rules.bendRadius, rules.thickness, rules.kFactor);

/**
 * A flat piece of the sheet (the base flange, or a straight piece of a flange) and how it lies in the
 * flat pattern: a point p maps to `origin + (p − at)·u, (p − at)·v`.
 */
interface Panel {
  readonly at: Vec3;
  readonly origin: Vec2;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly normal: Vec3;
  /** Whether a point lies in the piece (its faces and edges). */
  readonly contains: (p: Vec3) => boolean;
}

const place = (panel: Panel, p: Vec3): Vec2 => {
  const d = sub(p, panel.at);
  return [panel.origin[0] + dot(d, panel.u), panel.origin[1] + dot(d, panel.v)];
};
const turn = (panel: Panel, w: Vec3): Vec2 => [dot(w, panel.u), dot(w, panel.v)];

/**
 * Unfolds a sheet: the base flange's outlines, with each flange laid flat beyond the edge it stands on
 * (its bend allowances and straight pieces, mitred ends where it has them), and a bend line through
 * the middle of each bend. Flanges stand on the base flange or on straight pieces of earlier flanges,
 * so flanges on flanges unfold in turn. Where two flanges meet at a corner, the corner relief is cut.
 */
export function flatPattern(frame: PlaneFrame, profiles: readonly Profile[], flanges: readonly FlangeMarker[], rules: SheetMetalRules): Result<FlatPattern> {
  const t = rules.thickness;
  const normal = cross(frame.u, frame.v);
  const base: Panel = { at: frame.origin, origin: [0, 0], u: frame.u, v: frame.v, normal, contains: (p) => Math.abs(dot(sub(p, frame.origin), normal)) < t + 1e-6 };
  let cuts: ProfileEdge[] = profiles.flatMap((p) => [p.outer, ...p.holes].flatMap((loop) => loop.edges)).map((e) => ({ ...e, source: 'cut' }));
  const bends: ProfileEdge[] = [];
  const panels: Panel[] = [];
  const standsOn: Panel[] = [];
  for (const flange of flanges) {
    const along = unitVec(sub(flange.end, flange.start));
    const length = Math.hypot(...sub(flange.end, flange.start));
    // The flat piece it stands on: the latest one holding its edge, square to the face it bends from.
    const fits = (panel: Panel) =>
      Math.abs(dot(along, panel.normal)) < 1e-6 && Math.abs(dot(flange.away, panel.normal)) < 1e-6 && Math.abs(Math.abs(dot(flange.up, panel.normal)) - 1) < 1e-6;
    const panel = [...panels].reverse().find((p) => fits(p) && p.contains(flange.start) && p.contains(flange.end)) ?? (fits(base) && base.contains(flange.start) && base.contains(flange.end) ? base : undefined);
    if (!panel) return fail({ code: 'not-unfoldable', message: 'A flange does not stand on a flat piece of the sheet, so it cannot be unfolded.' });
    standsOn.push(panel);
    const [s, e] = [place(panel, flange.start), place(panel, flange.end)];
    const [dirAlong, away] = [unit2(turn(panel, along)), unit2(turn(panel, flange.away))];
    // The outline edge it stands on is replaced where they overlap.
    const index = cuts.findIndex((c) => c.kind === 'line' && onLine(s, c.start, c.end) && onLine(e, c.start, c.end));
    const edge = cuts[index];
    if (!edge || edge.kind !== 'line') return fail({ code: 'not-unfoldable', message: 'A flange does not stand on a straight outline of the flat pattern.' });
    const section = flangeSection(flange.pieces, t, rules.kFactor);
    const [reachStart, reachEnd] = [flange.miter?.start ?? 0, flange.miter?.end ?? 0];
    // The ends: square, or mitred along the neutral layer.
    const depths = reachStart || reachEnd ? section.neutral.map((n) => n.flat) : [0, section.width];
    const point = (u: number, d: number): Vec2 => along2(along2(s, dirAlong, u), away, d);
    const startSide = depths.map((d) => point(-reachStart * neutralAway(section, d), d));
    const endSide = depths.map((d) => point(length + reachEnd * neutralAway(section, d), d));
    const forwards = position(edge.start, edge.end, s) <= position(edge.start, edge.end, e);
    const path = forwards ? [...startSide, ...endSide.reverse()] : [...endSide, ...startSide.reverse()];
    const [first, last] = [path[0] as Vec2, path.at(-1) as Vec2];
    const rest: ProfileEdge[] = [];
    if (!close(edge.start, first)) rest.push(line(edge.start, first));
    for (let i = 1; i < path.length; i++) if (!close(path[i - 1] as Vec2, path[i] as Vec2)) rest.push(line(path[i - 1] as Vec2, path[i] as Vec2));
    if (!close(last, edge.end)) rest.push(line(last, edge.end));
    cuts = [...cuts.slice(0, index), ...rest, ...cuts.slice(index + 1)];
    for (const d of section.bendLines) bends.push(line(point(-reachStart * neutralAway(section, d), d), point(length + reachEnd * neutralAway(section, d), d), 'bend'));
    // Its straight pieces are flat pieces later flanges may stand on.
    const reach = Math.max(Math.abs(reachStart), Math.abs(reachEnd)) * Math.max(0, ...section.neutral.map((n) => Math.abs(n.point[0])));
    for (const straight of section.straights) {
      const at = add(add(flange.start, flange.away, straight.start[0]), flange.up, straight.start[1]);
      const direction = add(scale(flange.away, straight.direction[0]), flange.up, straight.direction[1]);
      const material = add(scale(flange.away, straight.direction[1]), flange.up, -straight.direction[0]);
      panels.push({
        at,
        origin: along2(s, away, straight.flat),
        u: add(scale(along, dirAlong[0]), direction, away[0]),
        v: add(scale(along, dirAlong[1]), direction, away[1]),
        normal: material,
        contains: (p) => {
          const d = sub(p, at);
          const [u, w, off] = [dot(sub(p, flange.start), along), dot(d, direction), dot(d, material)];
          return u > -reach - 1e-6 && u < length + reach + 1e-6 && w > -1e-6 && w < straight.length + 1e-6 && off > -1e-6 && off < t + 1e-6;
        },
      });
    }
  }
  if (rules.relief) {
    for (const corner of flangeCorners(flanges)) {
      const panel = standsOn[corner.first];
      if (!panel || panel !== standsOn[corner.second]) continue;
      const relieved = relieve(cuts, place(panel, corner.at), rules.relief);
      if (!relieved.ok) return relieved;
      cuts = relieved.value;
    }
  }
  return ok({ cuts, bends });
}

const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const unitVec = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1));

/**
 * Cuts a corner relief where the outline turns at `c` between two flanges: a round of the size's
 * diameter or a square of its side centred on the corner, taken out of the sheet around it; a tear
 * is a cut of the size's length into the sheet, halfway between the flanges, that removes nothing.
 */
function relieve(cuts: ProfileEdge[], c: Vec2, relief: { readonly shape: CornerRelief; readonly size: number }): Result<ProfileEdge[]> {
  const into = cuts.findIndex((e) => e.kind === 'line' && close(e.end, c));
  const out = cuts.findIndex((e) => e.kind === 'line' && close(e.start, c));
  const [before, after] = [cuts[into], cuts[out]];
  if (!before || !after || before.kind !== 'line' || after.kind !== 'line') return ok(cuts);
  // The two flanges' sides leave the corner along a and b; the sheet lies all round except between them.
  const a = unit2([before.start[0] - c[0], before.start[1] - c[1]]);
  const b = unit2([after.end[0] - c[0], after.end[1] - c[1]]);
  if (relief.shape === 'tear') return ok([...cuts, line(c, along2(c, unit2([-(a[0] + b[0]), -(a[1] + b[1])]), relief.size))]);
  const h = relief.size / 2;
  const room = Math.min(Math.hypot(before.start[0] - c[0], before.start[1] - c[1]), Math.hypot(after.end[0] - c[0], after.end[1] - c[1]));
  if (!(h < room - 1e-6)) return fail({ code: 'not-unfoldable', message: 'The corner relief is larger than the flanges beside it.' });
  const [from, to] = [along2(c, a, h), along2(c, b, h)];
  const cut: ProfileEdge[] =
    relief.shape === 'round'
      ? // The long way round, through the sheet: against the short turn from a to b.
        [{ kind: 'arc', start: from, end: to, center: c, radius: h, ccw: a[0] * b[1] - a[1] * b[0] < 0, source: 'cut' }]
      : [
          [from, along2(from, b, -h)],
          [along2(from, b, -h), along2(along2(c, a, -h), b, -h)],
          [along2(along2(c, a, -h), b, -h), along2(along2(c, a, -h), b, h)],
          [along2(along2(c, a, -h), b, h), to],
        ].map(([p, q]) => line(p as Vec2, q as Vec2));
  const replaced = cuts.map((e, i) => (i === into ? [line(before.start, from), ...cut] : i === out ? [line(to, after.end)] : [e]));
  return ok(replaced.flat());
}

/** Where `p` lies along the segment from `a` to `b` (0 at a, 1 at b). */
function position(a: Vec2, b: Vec2, p: Vec2): number {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  return ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
}

/** Whether `p` lies on the segment from `a` to `b`. */
function onLine(p: Vec2, a: Vec2, b: Vec2): boolean {
  const t = position(a, b, p);
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const off = Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / Math.hypot(d[0], d[1]);
  return t > -1e-6 && t < 1 + 1e-6 && off < 1e-5;
}
