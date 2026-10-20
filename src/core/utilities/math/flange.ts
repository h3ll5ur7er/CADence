/**
 * The cross-section of a sheet metal flange, square to the edge it stands on, in (away, up)
 * coordinates: the edge is at (0, 0) on the face the first bend turns towards, the sheet lies
 * below it down to (0, -t), and the flange goes on to the right of the edge. Shared by the
 * kernel, which extrudes it, and the flat pattern, which lays it flat.
 */
type Point = readonly [number, number];

/** A bend by `angle` (radians, positive turns towards the face, to the left) round an inside `radius`, then a straight piece. */
export interface BendThenStraight {
  readonly angle: number;
  readonly radius: number;
  readonly length: number;
}

export type SectionPiece = { readonly kind: 'line'; readonly start: Point; readonly end: Point } | { readonly kind: 'arc'; readonly start: Point; readonly mid: Point; readonly end: Point };

export interface FlangeSection {
  /** The surface the edge is on, from the edge outwards. */
  readonly top: readonly SectionPiece[];
  /** The other surface, from (0, -t) outwards. */
  readonly bottom: readonly SectionPiece[];
  /** Each straight piece: where it starts on the top surface, its direction, its length, and where it starts in the flat pattern. */
  readonly straights: readonly { readonly start: Point; readonly direction: Point; readonly length: number; readonly flat: number }[];
  /** Where the middle of each bend lies in the flat pattern. */
  readonly bendLines: readonly number[];
  /** The flange's length in the flat pattern: the bend allowances and the straight pieces. */
  readonly width: number;
  /** Points of the neutral layer by their distance into the flat pattern, in order (bends sampled, straights by their ends). */
  readonly neutral: readonly { readonly flat: number; readonly point: Point }[];
}

const rotate = (v: Point, angle: number): Point => [v[0] * Math.cos(angle) - v[1] * Math.sin(angle), v[0] * Math.sin(angle) + v[1] * Math.cos(angle)];
const plus = (a: Point, b: Point, s = 1): Point => [a[0] + b[0] * s, a[1] + b[1] * s];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const left = (d: Point): Point => [-d[1], d[0]];
const right = (d: Point): Point => [d[1], -d[0]];

/** The flat length a bend takes: the length of the neutral layer through it, `kFactor` of the thickness from the inside. */
export const bendLength = (angle: number, radius: number, thickness: number, kFactor: number): number => Math.abs(angle) * (radius + kFactor * thickness);

/** Walks a flange's bends and straight pieces: its two surfaces, and where everything lies in the flat pattern. */
export function flangeSection(pieces: readonly BendThenStraight[], thickness: number, kFactor = 0.5): FlangeSection {
  const t = thickness;
  let p: Point = [0, 0];
  let d: Point = [1, 0];
  let flat = 0;
  const top: SectionPiece[] = [];
  const bottom: SectionPiece[] = [];
  const straights: { start: Point; direction: Point; length: number; flat: number }[] = [];
  const bendLines: number[] = [];
  const neutral: { flat: number; point: Point }[] = [{ flat: 0, point: plus(p, right(d), kFactor * t) }];
  for (const piece of pieces) {
    const { angle, radius: r } = piece;
    if (Math.abs(angle) > 1e-12) {
      const q = plus(p, right(d), t);
      // The centre lies on the inside: beside the top surface for a turn to the left, beside the other one for a turn to the right.
      const c = angle > 0 ? plus(p, left(d), r) : plus(q, right(d), r);
      const turn = (x: Point, by: number) => plus(c, rotate(minus(x, c), by));
      const arc = (from: Point): SectionPiece | undefined => (Math.hypot(...minus(from, c)) > 1e-9 ? { kind: 'arc', start: from, mid: turn(from, angle / 2), end: turn(from, angle) } : undefined);
      const [onTop, onBottom] = [arc(p), arc(q)];
      if (onTop) top.push(onTop);
      if (onBottom) bottom.push(onBottom);
      const allowance = bendLength(angle, r, t, kFactor);
      // The neutral layer, `kFactor` of the thickness from the inside surface.
      const inside = angle > 0 ? p : q;
      const along = minus(inside, c);
      const n = Math.hypot(...along);
      const radial: Point = n > 1e-9 ? [along[0] / n, along[1] / n] : angle > 0 ? right(d) : left(d);
      const start = plus(c, radial, r + kFactor * t);
      const steps = 8;
      for (let i = 1; i <= steps; i++) neutral.push({ flat: flat + (allowance * i) / steps, point: turn(start, (angle * i) / steps) });
      bendLines.push(flat + allowance / 2);
      flat += allowance;
      p = turn(p, angle);
      d = rotate(d, angle);
    }
    if (piece.length > 0) {
      straights.push({ start: p, direction: d, length: piece.length, flat });
      const q = plus(p, right(d), t);
      top.push({ kind: 'line', start: p, end: plus(p, d, piece.length) });
      bottom.push({ kind: 'line', start: q, end: plus(q, d, piece.length) });
      const last = neutral.at(-1)?.point ?? p;
      p = plus(p, d, piece.length);
      flat += piece.length;
      neutral.push({ flat, point: plus(last, d, piece.length) });
    }
  }
  return { top, bottom, straights, bendLines, width: flat, neutral };
}

/** The away (first) coordinate of the neutral layer at a distance into the flat pattern. */
export function neutralAway(section: FlangeSection, flat: number): number {
  const samples = section.neutral;
  for (let i = 1; i < samples.length; i++) {
    const [a, b] = [samples[i - 1], samples[i]] as [(typeof samples)[number], (typeof samples)[number]];
    if (flat <= b.flat + 1e-9) {
      const f = b.flat - a.flat > 1e-12 ? (flat - a.flat) / (b.flat - a.flat) : 1;
      return a.point[0] + (b.point[0] - a.point[0]) * Math.min(1, Math.max(0, f));
    }
  }
  return samples.at(-1)?.point[0] ?? 0;
}
