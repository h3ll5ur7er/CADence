import { type FlangeMarker, originFrames, type ProfileEdge, type Vec2 } from '@core/contracts';
import { profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { describe, expect, it } from 'vitest';
import { bendAllowance, flatPattern, type SheetMetalRules } from './index';

const rules = { thickness: 2, bendRadius: 2, kFactor: 0.44 };
const plate = [profile(rectangleLoop(0, 0, 80, 40, 'plate'))];
const quarter = { angle: Math.PI / 2, radius: 2, length: 20 };
const flange: FlangeMarker = { feature: 'f', start: [80, 0, 2], end: [80, 40, 2], away: [1, 0, 0], up: [0, 0, 1], pieces: [quarter] };
const xs = (edges: readonly ProfileEdge[]) => edges.flatMap((e) => [e.start[0], e.end[0]]);
const allowance = bendAllowance(Math.PI / 2, rules);

/** The four flanges of an open box: one on each top edge of the plate. */
const box: FlangeMarker[] = [
  flange,
  { ...flange, start: [0, 40, 2], end: [80, 40, 2], away: [0, 1, 0] },
  { ...flange, start: [0, 0, 2], end: [0, 40, 2], away: [-1, 0, 0] },
  { ...flange, start: [0, 0, 2], end: [80, 0, 2], away: [0, -1, 0] },
];

function unfold(markers: readonly FlangeMarker[], sheet: SheetMetalRules = rules) {
  const pattern = flatPattern(originFrames.XY, plate, markers, sheet);
  if (!pattern.ok) throw new Error(pattern.error.message);
  return pattern.value;
}

/** The outline as points, arcs in short steps, piece after piece. */
function polyline(edges: readonly ProfileEdge[]): Vec2[][] {
  return edges.map((e) => {
    if (e.kind !== 'arc') return [e.start, e.end];
    const from = Math.atan2(e.start[1] - e.center[1], e.start[0] - e.center[0]);
    let sweep = Math.atan2(e.end[1] - e.center[1], e.end[0] - e.center[0]) - from;
    if (e.ccw && sweep <= 0) sweep += 2 * Math.PI;
    if (!e.ccw && sweep >= 0) sweep -= 2 * Math.PI;
    return Array.from({ length: 65 }, (_, i): Vec2 => [e.center[0] + e.radius * Math.cos(from + (sweep * i) / 64), e.center[1] + e.radius * Math.sin(from + (sweep * i) / 64)]);
  });
}

/** Whether the outline is one closed loop, piece after piece, that never crosses or touches itself. */
function simpleLoop(edges: readonly ProfileEdge[]): boolean {
  const pieces = polyline(edges);
  const near = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
  if (!pieces.every((p, i) => near(p.at(-1) as Vec2, (pieces[(i + 1) % pieces.length] as Vec2[])[0] as Vec2))) return false;
  const segments = pieces.flatMap((p) => p.slice(1).map((q, i) => [p[i] as Vec2, q] as const));
  const crosses = (a: readonly [Vec2, Vec2], b: readonly [Vec2, Vec2]) => {
    const side = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const [d1, d2, d3, d4] = [side(b[0], b[1], a[0]), side(b[0], b[1], a[1]), side(a[0], a[1], b[0]), side(a[0], a[1], b[1])];
    return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
  };
  const n = segments.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1) && crosses(segments[i] as never, segments[j] as never)) return false;
  // No point visited twice (a touch at a corner).
  const points = segments.map((s) => s[0]);
  return points.every((p, i) => points.every((q, j) => i === j || !near(p, q)));
}

/** The area inside the outline (shoelace over the stepped outline). */
function area(edges: readonly ProfileEdge[]): number {
  const points = polyline(edges).flatMap((p) => p.slice(0, -1));
  return Math.abs(points.reduce((sum, p, i) => sum + p[0] * (points[(i + 1) % points.length] as Vec2)[1] - (points[(i + 1) % points.length] as Vec2)[0] * p[1], 0)) / 2;
}

describe('flat patterns', () => {
  it('lays a flange flat beyond its edge: the bend allowance, then the flange', () => {
    expect(allowance).toBeCloseTo((Math.PI / 2) * (2 + 0.44 * 2));
    const pattern = unfold([flange]);
    // The right edge is gone from the cut; the outline now reaches out to 80 + allowance + 20.
    expect(pattern.cuts.some((c) => c.kind === 'line' && c.start[0] === 80 && c.end[0] === 80)).toBe(false);
    expect(Math.max(...xs(pattern.cuts))).toBeCloseTo(80 + allowance + 20);
    expect(pattern.cuts).toHaveLength(6);
    // One bend line, through the middle of the bend.
    const middle = expect.closeTo(80 + allowance / 2, 9);
    expect(pattern.bends).toEqual([{ kind: 'line', start: [middle, expect.closeTo(0, 9)], end: [middle, expect.closeTo(40, 9)], source: 'bend' }]);
  });

  it('keeps the rest of an edge a shorter flange stands on', () => {
    const short: FlangeMarker = { ...flange, start: [80, 10, 2], end: [80, 30, 2] };
    expect(unfold([short]).cuts).toHaveLength(8);
  });

  it('refuses flanges that do not stand on a flat piece of the sheet', () => {
    const upright: FlangeMarker = { ...flange, away: [0, 0, 1] };
    expect(flatPattern(originFrames.XY, plate, [upright], rules)).toMatchObject({ ok: false });
    const elsewhere: FlangeMarker = { ...flange, start: [50, 0, 2], end: [50, 40, 2] };
    expect(flatPattern(originFrames.XY, plate, [elsewhere], rules)).toMatchObject({ ok: false });
  });

  it('unfolds a flange on a flange beyond the one it stands on', () => {
    // The first flange stands up from x = 82 to 84 (inside radius 2, thickness 2), its top at z = 24; the
    // second bends out from its outer top edge.
    const onTop: FlangeMarker = { feature: 'g', start: [84, 0, 24], end: [84, 40, 24], away: [0, 0, 1], up: [1, 0, 0], pieces: [{ ...quarter, length: 10 }] };
    const pattern = unfold([flange, onTop]);
    expect(Math.max(...xs(pattern.cuts))).toBeCloseTo(80 + 2 * allowance + 30);
    expect(simpleLoop(pattern.cuts)).toBe(true);
    expect(pattern.bends.map((b) => b.start[0])).toEqual([expect.closeTo(80 + allowance / 2), expect.closeTo(80 + allowance + 20 + allowance / 2)]);
  });

  it('unfolds a box of four flanges without overlaps', () => {
    const pattern = unfold(box);
    expect(simpleLoop(pattern.cuts)).toBe(true);
    const width = allowance + 20;
    expect(area(pattern.cuts)).toBeCloseTo(80 * 40 + 2 * (80 + 40) * width, 6);
    expect(pattern.bends).toHaveLength(4);
  });

  it('cuts round, square and tear reliefs where flanges meet at a corner', () => {
    const width = allowance + 20;
    const whole = 80 * 40 + 2 * (80 + 40) * width;
    const round = unfold(box, { ...rules, relief: { shape: 'round', size: 4 } }).cuts;
    expect(simpleLoop(round)).toBe(true);
    expect(round.filter((c) => c.kind === 'arc')).toHaveLength(4);
    // Each corner loses three quarters of a circle of 4 mm diameter.
    expect(area(round)).toBeCloseTo(whole - 4 * 0.75 * Math.PI * 4, 1);
    const square = unfold(box, { ...rules, relief: { shape: 'square', size: 4 } }).cuts;
    expect(simpleLoop(square)).toBe(true);
    expect(area(square)).toBeCloseTo(whole - 4 * 3 * 4, 6);
    // A tear removes nothing: a cut of its length into the sheet at each corner, halfway between the flanges.
    const tear = unfold(box, { ...rules, relief: { shape: 'tear', size: 3 } }).cuts;
    const tears = tear.slice(-4);
    expect(tears.map((c) => Math.hypot(c.end[0] - c.start[0], c.end[1] - c.start[1]))).toEqual(Array(4).fill(expect.closeTo(3, 9)));
    expect(tears.find((c) => c.start[0] === 80 && c.start[1] === 40)?.end).toEqual([expect.closeTo(80 - 3 / Math.SQRT2), expect.closeTo(40 - 3 / Math.SQRT2)]);
    expect(flatPattern(originFrames.XY, plate, box, { ...rules, relief: { shape: 'round', size: 60 } })).toMatchObject({ ok: false });
  });

  it('unfolds a hem: half a turn round half its gap, then its length', () => {
    const hem: FlangeMarker = { ...flange, pieces: [{ angle: Math.PI, radius: 1, length: 10 }] };
    const pattern = unfold([hem]);
    expect(Math.max(...xs(pattern.cuts))).toBeCloseTo(80 + Math.PI * (1 + 0.44 * 2) + 10);
    expect(pattern.bends[0]?.start[0]).toBeCloseTo(80 + (Math.PI * (1 + 0.44 * 2)) / 2);
  });

  it('unfolds a miter flange: each edge its own piece, mitred along the neutral layer', () => {
    // The right and top edges; both pieces reach past the corner they share as far as they stand away from it.
    const top: FlangeMarker = { ...flange, start: [0, 40, 2], end: [80, 40, 2], away: [0, 1, 0], miter: { start: 0, end: 1 } };
    const right: FlangeMarker = { ...flange, miter: { start: 0, end: 1 } };
    const pattern = unfold([right, top]);
    expect(simpleLoop(pattern.cuts)).toBe(true);
    // Beyond the bend the neutral layer stands r + K·t away from the edge.
    const ys = pattern.cuts.flatMap((c) => [c.start, c.end]).filter((p) => p[0] > 80 + allowance).map((p) => p[1]);
    expect(Math.max(...ys)).toBeCloseTo(40 + 2 + 0.44 * 2);
    expect(pattern.bends[0]?.end[1]).toBeGreaterThan(40);
    expect(pattern.bends[0]?.end[1]).toBeLessThan(40 + 2 + 0.44 * 2);
  });
});

