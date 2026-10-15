import { describe, expect, it } from 'vitest';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';
import { placesAlong, sketchPath } from './path';

describe('sketch paths', () => {
  it('chains curves end to end, whatever order and direction they were drawn in', () => {
    // An L of two lines drawn backwards, then a quarter arc on its end.
    const b = new SketchBuilder();
    const [p0, p1, p2, p3] = [b.point(0, 0), b.point(20, 0), b.point(20, 10), b.point(30, 20)];
    b.line(p2, p1);
    b.arc(b.point(30, 10), p3, p2); // centre (30, 10), counter-clockwise from (30, 20) to (20, 10)
    b.line(p1, p0);
    b.line(b.point(50, 50), b.point(60, 50), true); // construction: not part of the path
    const path = sketchPath(b.build());
    if (!path.ok) throw new Error(path.error.message);
    expect(path.value.closed).toBe(false);
    const ends = path.value.pieces.map((p) => (p.kind === 'bezier' ? [p.points[0], p.points[3]] : [p.start, p.end]));
    expect(ends).toHaveLength(3);
    for (let i = 1; i < ends.length; i++) expect(ends[i]?.[0]).toEqual(ends[i - 1]?.[1]);
    const tips = [ends[0]?.[0], ends.at(-1)?.[1]].map((p) => p?.map((v) => Math.round(v * 1e6) / 1e6));
    expect(tips).toContainEqual([0, 0]);
    expect(tips).toContainEqual([30, 20]);
  });

  it('refuses curves that do not make one chain', () => {
    const b = new SketchBuilder();
    b.line(b.point(0, 0), b.point(10, 0));
    b.line(b.point(20, 0), b.point(30, 0));
    expect(sketchPath(b.build())).toMatchObject({ ok: false });
  });

  it('spaces places evenly by length, with the direction of travel', () => {
    const b = new SketchBuilder();
    const [p0, p1, p2] = [b.point(0, 0), b.point(30, 0), b.point(30, 30)];
    b.line(p0, p1);
    b.line(p1, p2);
    const path = sketchPath(b.build());
    if (!path.ok) throw new Error(path.error.message);
    const places = placesAlong(path.value, 3);
    const round = (v: readonly number[]) => v.map((x) => Math.round(x * 1e6) / 1e6 + 0);
    const forward = round(places[0]?.point ?? [])[0] === 0;
    const points = places.map((p) => round(p.point));
    expect(points[1]).toEqual([30, 0]);
    expect(forward ? points[2] : points[0]).toEqual([30, 30]);
    expect(round(places[1]?.direction ?? []).map(Math.abs)).toEqual(forward ? [1, 0] : [0, 1]);
  });

  it('goes round a circle, stopping short of the start', () => {
    const b = new SketchBuilder();
    b.circle(b.point(0, 0), 10);
    const path = sketchPath(b.build());
    if (!path.ok) throw new Error(path.error.message);
    expect(path.value.closed).toBe(true);
    const places = placesAlong(path.value, 4).map((p) => p.point.map((x) => Math.round(x * 1000) / 1000 + 0));
    expect(places).toEqual([[10, 0], [0, 10], [-10, 0], [0, -10]]);
  });
});
