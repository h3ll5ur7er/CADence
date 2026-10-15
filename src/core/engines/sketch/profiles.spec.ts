import { describe, expect, it } from 'vitest';
import { signedArea } from '@core/utilities/math';
import { findProfiles } from './profiles';
import { SketchBuilder } from '@core/contracts/testing/sketch-builder';

const areas = (b: SketchBuilder) =>
  findProfiles(b.build())
    .map((p) => p.area)
    .sort((x, y) => x - y);

describe('findProfiles', () => {
  it('finds the region inside a rectangle', () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
    const [profile] = findProfiles(b.build());
    expect(profile?.area).toBeCloseTo(800);
    expect(profile?.outer.edges).toHaveLength(4);
    expect(profile?.holes).toHaveLength(0);
  });

  it('turns a circle inside a rectangle into a hole and a disc', () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
    b.circle(b.point(20, 10), 5);
    const profiles = findProfiles(b.build());
    expect(profiles.map((p) => p.holes.length).sort()).toEqual([0, 1]);
    expect(areas(b)).toEqual([expect.closeTo(Math.PI * 25, 1), expect.closeTo(800 - Math.PI * 25, 1)]);
  });

  it('splits overlapping shapes at their intersections', () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [20, 0], [20, 20], [0, 20]);
    b.polygon([10, 10], [30, 10], [30, 30], [10, 30]);
    expect(areas(b)).toEqual([expect.closeTo(100), expect.closeTo(300), expect.closeTo(300)]);
  });

  it('splits a circle crossed by a line through its centre', () => {
    const b = new SketchBuilder();
    b.circle(b.point(0, 0), 10);
    b.line(b.point(-15, 0), b.point(15, 0));
    expect(areas(b)).toEqual([expect.closeTo(50 * Math.PI, 1), expect.closeTo(50 * Math.PI, 1)]);
  });

  it('builds a slot from lines and arcs', () => {
    const b = new SketchBuilder();
    const [p1, p2, p3, p4] = [b.point(0, -5), b.point(20, -5), b.point(20, 5), b.point(0, 5)] as [string, string, string, string];
    b.line(p1, p2);
    b.arc(b.point(20, 0), p2, p3);
    b.line(p3, p4);
    b.arc(b.point(0, 0), p4, p1);
    const [slot] = findProfiles(b.build());
    expect(slot?.area).toBeCloseTo(200 + 25 * Math.PI, 1);
    expect(slot?.outer.edges.map((e) => e.kind).sort()).toEqual(['arc', 'arc', 'line', 'line']);
  });

  it('ignores construction geometry and dangling lines', () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [10, 0], [10, 10], [0, 10]);
    b.line(b.point(-5, -5), b.point(15, 15), true);
    b.line(b.point(10, 10), b.point(20, 20));
    expect(areas(b)).toEqual([expect.closeTo(100)]);
  });

  it('keeps profile ids stable when geometry moves', () => {
    const b1 = new SketchBuilder();
    b1.polygon([0, 0], [10, 0], [10, 10], [0, 10]);
    const b2 = new SketchBuilder();
    b2.polygon([0, 0], [15, 0], [15, 12], [0, 12]);
    expect(findProfiles(b1.build())[0]?.id).toBe(findProfiles(b2.build())[0]?.id);
  });

  it('closes an ellipse into one exact region, and cuts it with a line', () => {
    const b = new SketchBuilder();
    b.ellipse(b.point(0, 0), b.point(20, 0), 10);
    const [whole] = findProfiles(b.build());
    expect(whole?.area).toBeCloseTo(Math.PI * 200, 6);
    expect(whole?.outer.edges.map((e) => e.kind)).toEqual(['ellipse', 'ellipse']);
    b.line(b.point(0, -15), b.point(0, 15));
    expect(areas(b)).toEqual([expect.closeTo(Math.PI * 100, 6), expect.closeTo(Math.PI * 100, 6)]);
  });

  it('closes a region with a spline and a line, as Bézier pieces', () => {
    const b = new SketchBuilder();
    const [left, right] = [b.point(0, 0), b.point(40, 0)];
    b.line(left, right);
    b.spline([right, b.point(30, 15), b.point(10, 15), left]);
    const [profile] = findProfiles(b.build());
    expect(profile?.outer.edges.filter((e) => e.kind === 'bezier')).toHaveLength(3);
    // The exact area is a little larger than that of the polygon inscribed in the curve (0.01 mm chords).
    const inscribed = Math.abs(signedArea(profile?.outer.polygon ?? []));
    expect((profile?.area ?? 0) - inscribed).toBeGreaterThan(0);
    expect((profile?.area ?? 0) - inscribed).toBeLessThan(0.5);
    expect(profile?.area).toBeGreaterThan(400);
  });

  it('finds where a spline crosses lines and circles', () => {
    const b = new SketchBuilder();
    b.polygon([0, 0], [40, 0], [40, 20], [0, 20]);
    // A wave across the rectangle splits it in two.
    b.spline([b.point(-5, 10), b.point(10, 15), b.point(30, 5), b.point(45, 10)]);
    const parts = areas(b);
    expect(parts).toHaveLength(2);
    expect((parts[0] as number) + (parts[1] as number)).toBeCloseTo(800, 6);
  });

  it('makes a closed spline a region of its own', () => {
    const b = new SketchBuilder();
    b.spline([b.point(0, 0), b.point(20, 0), b.point(20, 20), b.point(0, 20)], true);
    const [profile] = findProfiles(b.build());
    expect(profile?.outer.edges).toHaveLength(4);
    expect(profile?.area).toBeGreaterThan(400);
  });
});
