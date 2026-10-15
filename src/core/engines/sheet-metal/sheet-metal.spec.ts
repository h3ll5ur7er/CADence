import { originFrames, type ProfileEdge } from '@core/contracts';
import { profile, rectangleLoop } from '@core/contracts/testing/profiles';
import { describe, expect, it } from 'vitest';
import { bendAllowance, flatPattern } from './index';

const rules = { thickness: 2, bendRadius: 2, kFactor: 0.44 };
const plate = [profile(rectangleLoop(0, 0, 80, 40, 'plate'))];
const flange = { feature: 'f', start: [80, 0, 2] as const, end: [80, 40, 2] as const, away: [1, 0, 0] as const, up: [0, 0, 1] as const, length: 20, angle: Math.PI / 2 };
const xs = (edges: readonly ProfileEdge[]) => edges.flatMap((e) => [e.start[0], e.end[0]]);

describe('flat patterns', () => {
  it('lays a flange flat beyond its edge: the bend allowance, then the flange', () => {
    const allowance = bendAllowance(Math.PI / 2, rules);
    expect(allowance).toBeCloseTo((Math.PI / 2) * (2 + 0.44 * 2));
    const pattern = flatPattern(originFrames.XY, plate, [flange], rules);
    if (!pattern.ok) throw new Error(pattern.error.message);
    // The right edge is gone from the cut; the outline now reaches out to 80 + allowance + 20.
    expect(pattern.value.cuts.some((c) => c.kind === 'line' && c.start[0] === 80 && c.end[0] === 80)).toBe(false);
    expect(Math.max(...xs(pattern.value.cuts))).toBeCloseTo(80 + allowance + 20);
    expect(pattern.value.cuts).toHaveLength(6);
    // One bend line, through the middle of the bend.
    const middle = expect.closeTo(80 + allowance / 2, 9);
    expect(pattern.value.bends).toEqual([{ kind: 'line', start: [middle, 0], end: [middle, 40], source: 'bend' }]);
  });

  it('keeps the rest of an edge a shorter flange stands on', () => {
    const short = { ...flange, start: [80, 10, 2] as const, end: [80, 30, 2] as const };
    const pattern = flatPattern(originFrames.XY, plate, [short], rules);
    if (!pattern.ok) throw new Error(pattern.error.message);
    expect(pattern.value.cuts).toHaveLength(8);
  });

  it('refuses flanges that do not stand on the base flange', () => {
    const upright = { ...flange, away: [0, 0, 1] as const };
    expect(flatPattern(originFrames.XY, plate, [upright], rules)).toMatchObject({ ok: false });
    const elsewhere = { ...flange, start: [50, 0, 2] as const, end: [50, 40, 2] as const };
    expect(flatPattern(originFrames.XY, plate, [elsewhere], rules)).toMatchObject({ ok: false });
  });
});
