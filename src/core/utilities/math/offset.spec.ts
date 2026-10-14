import { describe, expect, it } from 'vitest';
import { type LoopEdge, offsetLoop } from './offset';
import type { Vec2 } from './index';

const polygon = (...points: Vec2[]): LoopEdge[] =>
  points.map((start, i) => ({ kind: 'line', start, end: points[(i + 1) % points.length] as Vec2 }));

const circle = (r: number, ccw: boolean): LoopEdge[] => [
  { kind: 'arc', start: [r, 0], end: [-r, 0], center: [0, 0], radius: r, ccw },
  { kind: 'arc', start: [-r, 0], end: [r, 0], center: [0, 0], radius: r, ccw },
];

const corners = (edges: readonly LoopEdge[]) => edges.map((e) => e.start.map((v) => Math.round(v * 1e6) / 1e6));

describe('offsetLoop', () => {
  it('grows a counter-clockwise outline with sharp corners', () => {
    const square = offsetLoop(polygon([0, 0], [10, 0], [10, 10], [0, 10]), 0.1);
    expect(corners(square ?? [])).toEqual([
      [-0.1, -0.1],
      [10.1, -0.1],
      [10.1, 10.1],
      [-0.1, 10.1],
    ]);
  });

  it('trims the edges at concave corners', () => {
    const l = offsetLoop(polygon([0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]), 1);
    expect(corners(l ?? [])).toEqual([
      [-1, -1],
      [21, -1],
      [21, 11],
      [11, 11],
      [11, 21],
      [-1, 21],
    ]);
  });

  it('grows outer circles and shrinks holes (clockwise loops)', () => {
    const outer = offsetLoop(circle(2, true), 0.1);
    const hole = offsetLoop(circle(2, false), 0.1);
    expect(outer?.map((e) => e.kind === 'arc' && e.radius)).toEqual([2.1, 2.1]);
    expect(hole?.map((e) => e.kind === 'arc' && e.radius)).toEqual([1.9, 1.9]);
    expect(hole?.[0]?.start[0]).toBeCloseTo(1.9);
  });

  it('keeps tangent joins of rounded outlines', () => {
    // 20 × 10 slot: two lines and two half circles of radius 5.
    const slot: LoopEdge[] = [
      { kind: 'line', start: [0, 0], end: [20, 0] },
      { kind: 'arc', start: [20, 0], end: [20, 10], center: [20, 5], radius: 5, ccw: true },
      { kind: 'line', start: [20, 10], end: [0, 10] },
      { kind: 'arc', start: [0, 10], end: [0, 0], center: [0, 5], radius: 5, ccw: true },
    ];
    const grown = offsetLoop(slot, 0.5);
    expect(grown).toHaveLength(4);
    expect(corners(grown ?? [])).toEqual([
      [0, -0.5],
      [20, -0.5],
      [20, 10.5],
      [0, 10.5],
    ]);
    expect(grown?.filter((e) => e.kind === 'arc').map((e) => e.kind === 'arc' && e.radius)).toEqual([5.5, 5.5]);
  });

  it('gives nothing when a detail is smaller than the offset', () => {
    expect(offsetLoop(circle(0.05, false), 0.1)).toBeUndefined();
    expect(offsetLoop(polygon([0, 0], [10, 0], [10, 0.1], [0, 0.1]), -0.1)).toBeUndefined();
  });
});
