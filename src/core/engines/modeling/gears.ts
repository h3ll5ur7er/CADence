import type { Vec2 } from '@core/contracts';
import { draw, type Drawing } from 'replicad';

/**
 * Involute gear outlines as smooth curves (CAD-107): each flank one Bézier curve close to the true
 * involute, tips and roots arcs of their circles, and on external gears a root fillet. A spur gear has
 * four to eight faces per tooth, where a polygon had 23.
 */

/** A failure the user can act on. */
export class GearError extends Error {}

type Piece = { readonly kind: 'line'; readonly end: Vec2 } | { readonly kind: 'arc'; readonly via: Vec2; readonly end: Vec2 } | { readonly kind: 'bezier'; readonly controls: readonly Vec2[]; readonly end: Vec2 };

const involute = (a: number) => Math.tan(a) - a;
const polar = (rho: number, angle: number): Vec2 => [rho * Math.cos(angle), rho * Math.sin(angle)];
const turn = ([x, y]: Vec2, angle: number): Vec2 => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const mirror = ([x, y]: Vec2): Vec2 => [x, -y];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** The sizes of a gear and half the angle a tooth (of an external gear) spans at a radius. */
function geometry(module: number, teeth: number, pressureAngle: number) {
  const z = Math.round(teeth);
  const pitch = (module * z) / 2;
  const base = pitch * Math.cos(pressureAngle);
  const half = (rho: number) => Math.PI / (2 * z) + involute(pressureAngle) - involute(Math.acos(Math.min(1, base / rho)));
  return { z, pitch, base, half };
}

const degree = 5;
const binomial = [1, 5, 10, 10, 5, 1];
const bernstein = (k: number, t: number) => (binomial[k] as number) * t ** k * (1 - t) ** (degree - k);

function bezierAt(controls: readonly Vec2[], t: number): Vec2 {
  let [x, y] = [0, 0];
  controls.forEach((p, k) => {
    const b = bernstein(k, t);
    x += b * p[0];
    y += b * p[1];
  });
  return [x, y];
}

function bezierDerivative(controls: readonly Vec2[], t: number): Vec2 {
  const differences = controls.slice(1).map((p, k) => sub(p, controls[k] as Vec2));
  let [x, y] = [0, 0];
  differences.forEach((d, k) => {
    const b = [1, 4, 6, 4, 1][k] as number;
    const w = degree * b * t ** k * (1 - t) ** (degree - 1 - k);
    x += w * d[0];
    y += w * d[1];
  });
  return [x, y];
}

/** Solves a small linear system (Gaussian elimination with pivoting). */
function solve(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i] as number]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs((a[j] as number[])[i] as number) > Math.abs((a[pivot] as number[])[i] as number)) pivot = j;
    [a[i], a[pivot]] = [a[pivot] as number[], a[i] as number[]];
    const row = a[i] as number[];
    for (let j = i + 1; j < n; j++) {
      const other = a[j] as number[];
      const f = (other[i] as number) / (row[i] as number);
      for (let k = i; k <= n; k++) other[k] = (other[k] as number) - f * (row[k] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    const row = a[i] as number[];
    let s = row[n] as number;
    for (let k = i + 1; k < n; k++) s -= (row[k] as number) * (x[k] as number);
    x[i] = s / (row[i] as number);
  }
  return x;
}

/**
 * A quintic Bézier close to the flank `at(rho)` from radius `from` to `to`: the ends on the flank, the
 * start tangent along it, the rest fitted by least squares with the parameters corrected (Hoschek).
 */
export function fitFlank(at: (rho: number) => Vec2, base: number, from: number, to: number): Vec2[] {
  // Evenly by roll angle: the involute bends most near the base circle.
  const roll = (rho: number) => Math.sqrt(Math.max(0, (rho * rho) / (base * base) - 1));
  const [r0, r1] = [roll(from), roll(to)];
  const samples = 60;
  const points = Array.from({ length: samples + 1 }, (_, i) => at(Math.min(to, Math.max(from, base * Math.sqrt(1 + (r0 + ((r1 - r0) * i) / samples) ** 2)))));
  const [first, last] = [points[0] as Vec2, points[samples] as Vec2];
  const tangent = unit(sub(at(from + 1e-7 * (to - from)), first));
  const lengths = [0];
  for (let i = 1; i <= samples; i++) lengths.push((lengths[i - 1] as number) + Math.hypot(...sub(points[i] as Vec2, points[i - 1] as Vec2)));
  let u = lengths.map((l) => l / (lengths[samples] as number));
  let controls: Vec2[] = [];
  for (let pass = 0; pass < 8; pass++) {
    // Unknowns: a (control 1 = first + a·tangent) and the free controls 2 … 4.
    const n = 7;
    const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const rhs = new Array<number>(n).fill(0);
    points.forEach((p, i) => {
      const t = u[i] as number;
      for (const k of [0, 1]) {
        const fixed = (bernstein(0, t) + bernstein(1, t)) * (first[k] as number) + bernstein(5, t) * (last[k] as number);
        const row = new Array<number>(n).fill(0);
        row[0] = bernstein(1, t) * (tangent[k] as number);
        for (let j = 0; j < 3; j++) row[1 + 2 * j + k] = bernstein(j + 2, t);
        for (let a = 0; a < n; a++) {
          rhs[a] = (rhs[a] as number) + (row[a] as number) * ((p[k] as number) - fixed);
          for (let b = 0; b < n; b++) (matrix[a] as number[])[b] = ((matrix[a] as number[])[b] as number) + (row[a] as number) * (row[b] as number);
        }
      }
    });
    const x = solve(matrix, rhs);
    controls = [first, [first[0] + (x[0] as number) * tangent[0], first[1] + (x[0] as number) * tangent[1]], [x[1] as number, x[2] as number], [x[3] as number, x[4] as number], [x[5] as number, x[6] as number], last];
    // Newton steps move each parameter to the point of the curve nearest its sample.
    u = u.map((t, i) => {
      if (i === 0 || i === samples) return t;
      const d = bezierDerivative(controls, t);
      const step = dot(sub(bezierAt(controls, t), points[i] as Vec2), d) / (dot(d, d) || 1);
      return Math.min(1, Math.max(0, t - step));
    });
  }
  return controls;
}

/** The pieces as a closed drawing, starting at `start`. */
function drawn(start: Vec2, pieces: readonly Piece[]): Drawing {
  let pen = draw([start[0], start[1]]);
  for (const piece of pieces) {
    if (piece.kind === 'line') pen = pen.lineTo([piece.end[0], piece.end[1]]);
    else if (piece.kind === 'arc') pen = pen.threePointsArcTo([piece.end[0], piece.end[1]], [piece.via[0], piece.via[1]]);
    else pen = pen.bezierCurveTo([piece.end[0], piece.end[1]], piece.controls.map((c) => [c[0], c[1]] as [number, number]));
  }
  return pen.close();
}

/** The pieces of one tooth (or space) turned to its place. */
function turned(pieces: readonly Piece[], angle: number): Piece[] {
  return pieces.map((p) => (p.kind === 'line' ? { kind: 'line', end: turn(p.end, angle) } : p.kind === 'arc' ? { kind: 'arc', via: turn(p.via, angle), end: turn(p.end, angle) } : { kind: 'bezier', controls: p.controls.map((c) => turn(c, angle)), end: turn(p.end, angle) }));
}

/** An arc of a circle about the origin from one angle to another (counter-clockwise when `to` > `from`). */
const arc = (rho: number, from: number, to: number): Piece => ({ kind: 'arc', via: polar(rho, (from + to) / 2), end: polar(rho, to) });

/** A flank as a Bézier piece, from its start to its end (or reversed: from the end back to the start). */
function flankPiece(controls: readonly Vec2[], reverse: boolean): Piece {
  const ordered = reverse ? [...controls].reverse() : controls;
  return { kind: 'bezier', controls: ordered.slice(1, -1), end: ordered[ordered.length - 1] as Vec2 };
}

/**
 * The root fillet: the largest radius (at most 0.38 module, ISO 53) whose arc meets the root circle
 * and a radial line through `angle`, staying below the mating tip's reach and inside half the gap.
 */
function filletRadius(root: number, reach: number, gap: number, module: number): number {
  if (!(reach > root)) return 0;
  const touching = (rho: number) => Math.atan(rho / Math.sqrt(root * root + 2 * root * rho));
  let high = Math.min(0.38 * module, (reach * reach - root * root) / (2 * root));
  if (touching(high) > 0.9 * gap) {
    let low = 0;
    for (let i = 0; i < 40; i++) {
      const mid = (low + high) / 2;
      if (touching(mid) > 0.9 * gap) high = mid;
      else low = mid;
    }
    high = low;
  }
  return high > 1e-6 * module ? high : 0;
}

/** The outline of a spur gear with involute teeth, a tooth centred on the x axis. */
export function gearDrawing(module: number, teeth: number, pressureAngle: number): Drawing {
  const { z, pitch, base, half } = geometry(module, teeth, pressureAngle);
  if (z < 6) throw new GearError('A gear needs at least 6 teeth.');
  const [tip, root] = [pitch + module, pitch - 1.25 * module];
  if (!(root > 0)) throw new GearError('The gear is too small for its module.');
  if (!(half(tip) > 0)) throw new GearError('The teeth come to a point: use more teeth or a smaller pressure angle.');
  const start = Math.max(base, root);
  // The flank below the tooth (clockwise side), from its start up to the tip.
  const flank = fitFlank((rho) => polar(rho, -half(rho)), base, start, tip);
  const fillet = filletRadius(root, Math.min(start, pitch - module), Math.PI / z - half(start), module);
  const foot = Math.sqrt(root * root + 2 * root * fillet); // where the fillet meets the radial line
  const side = -half(start);
  const sweep = Math.atan(fillet / foot); // from the radial line to the fillet's touch on the root circle
  const centre = polar(root + fillet, side - sweep);
  const [toRoot, toFoot] = [unit(sub(polar(root, side - sweep), centre)), unit(sub(polar(foot, side), centre))];
  const bisector = unit([toRoot[0] + toFoot[0], toRoot[1] + toFoot[1]]);
  const filletVia: Vec2 = [centre[0] + fillet * bisector[0], centre[1] + fillet * bisector[1]];
  const radial = start > foot + 1e-9 * module;
  // One tooth, counter-clockwise: up the clockwise flank, over the tip, down the other, along the root to the next.
  const tooth: Piece[] = [];
  if (fillet > 0) tooth.push({ kind: 'arc', via: filletVia, end: polar(foot, side) });
  if (radial) tooth.push({ kind: 'line', end: polar(start, side) });
  tooth.push(flankPiece(flank, false), arc(tip, -half(tip), half(tip)), flankPiece(flank.map(mirror), true));
  if (radial) tooth.push({ kind: 'line', end: polar(foot, -side) });
  if (fillet > 0) tooth.push({ kind: 'arc', via: mirror(filletVia), end: polar(root, -side + sweep) });
  const next = (2 * Math.PI) / z;
  if (next + side - sweep > -side + sweep + 1e-9) tooth.push(arc(root, -side + sweep, next + side - sweep));
  const first = fillet > 0 ? polar(root, side - sweep) : polar(start, side);
  return drawn(first, Array.from({ length: z }, (_, k) => turned(tooth, k * next)).flat());
}

/**
 * The inside outline of a ring gear (internal teeth, CAD-98): a tooth space centred on the x axis,
 * so a planet with a tooth along its x axis meshes at (centre distance, 0). Its spaces are an external
 * gear's teeth: involute flanks of the same base circle, here from the ring's tip circle (pitch − m)
 * out to its root circle (pitch + 1.25 m).
 */
export function ringGearDrawing(module: number, teeth: number, pressureAngle: number): Drawing {
  const { z, pitch, base, half } = geometry(module, teeth, pressureAngle);
  if (z < 20) throw new GearError('A ring gear needs at least 20 teeth.');
  const [inner, outer] = [pitch - module, pitch + 1.25 * module];
  if (!(half(outer) > 0)) throw new GearError('The tooth spaces come to a point: use more teeth or a smaller pressure angle.');
  const start = Math.max(base, inner);
  if (!(Math.PI / z > half(inner))) throw new GearError('The teeth are too thin at their tips.');
  const flank = fitFlank((rho) => polar(rho, -half(rho)), base, start, outer);
  const side = -half(start);
  const space: Piece[] = [];
  if (start > inner + 1e-9 * module) space.push({ kind: 'line', end: polar(start, side) });
  space.push(flankPiece(flank, false), arc(outer, -half(outer), half(outer)), flankPiece(flank.map(mirror), true));
  if (start > inner + 1e-9 * module) space.push({ kind: 'line', end: polar(inner, -side) });
  const next = (2 * Math.PI) / z;
  space.push(arc(inner, half(inner), next - half(inner)));
  return drawn(polar(inner, -half(inner)), Array.from({ length: z }, (_, k) => turned(space, k * next)).flat());
}

/** The outline of a gear rack along x, the pitch line at y = height, teeth upwards. */
export function rackOutline(module: number, teeth: number, height: number, pressureAngle: number): Vec2[] {
  const n = Math.round(teeth);
  if (n < 1) throw new GearError('A rack needs at least one tooth.');
  const pitch = Math.PI * module;
  const [top, bottom] = [height + module, height - 1.25 * module];
  if (!(bottom > 0)) throw new GearError('The rack is not high enough for its teeth.');
  const slope = Math.tan(pressureAngle);
  const [tipHalf, rootHalf] = [pitch / 4 - module * slope, pitch / 4 + 1.25 * module * slope];
  const length = n * pitch;
  const points: Vec2[] = [
    [0, 0],
    [length, 0],
  ];
  for (let k = n - 1; k >= 0; k--) {
    const c = (k + 0.5) * pitch;
    points.push([Math.min(length, c + rootHalf), bottom], [c + tipHalf, top], [c - tipHalf, top], [Math.max(0, c - rootHalf), bottom]);
  }
  return points;
}
