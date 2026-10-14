import { describe, expect, it } from 'vitest';
import { findProfiles } from './profiles';
import { SketchBuilder } from './testing/sketch-builder';

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
});
