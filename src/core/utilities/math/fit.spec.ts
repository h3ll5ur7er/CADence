import { describe, expect, it } from 'vitest';
import { fitArcs } from './fit';
import { type Vec2 } from './index';

const circlePoints = (cx: number, cy: number, r: number, from: number, to: number, n: number): Vec2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

describe('fitting lines and arcs', () => {
  it('finds one arc in points along a circle, keeping its ends exact', () => {
    const points = circlePoints(5, 5, 10, 0, Math.PI / 2, 40);
    const pieces = fitArcs(points, 0.01);
    expect(pieces).toHaveLength(1);
    const [arc] = pieces;
    expect(arc).toMatchObject({ kind: 'arc', radius: expect.closeTo(10, 6), center: [expect.closeTo(5, 6), expect.closeTo(5, 6)], ccw: true });
    expect(arc?.start).toEqual(points[0]);
    expect(arc?.end).toEqual(points.at(-1));
  });

  it('finds lines where points are straight, and turns the way the points run', () => {
    const points: Vec2[] = [[0, 0], [5, 0], [10, 0], ...circlePoints(10, -5, 5, Math.PI / 2, 0, 20).slice(1)];
    const pieces = fitArcs(points, 0.01);
    expect(pieces.map((p) => p.kind)).toEqual(['line', 'arc']);
    expect(pieces[1]).toMatchObject({ ccw: false, radius: expect.closeTo(5, 6) });
    expect(pieces[0]?.end).toEqual(pieces[1]?.start);
  });

  it('stays within the tolerance on curves that are neither', () => {
    const wave = Array.from({ length: 201 }, (_, i): Vec2 => [i * 0.1, Math.sin(i * 0.1) * 3]);
    const pieces = fitArcs(wave, 0.01);
    expect(pieces.length).toBeLessThan(40);
    for (const p of wave) {
      const nearest = Math.min(
        ...pieces.map((piece) => {
          if (piece.kind === 'line') {
            const d: Vec2 = [piece.end[0] - piece.start[0], piece.end[1] - piece.start[1]];
            const t = Math.max(0, Math.min(1, ((p[0] - piece.start[0]) * d[0] + (p[1] - piece.start[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2)));
            return Math.hypot(p[0] - piece.start[0] - t * d[0], p[1] - piece.start[1] - t * d[1]);
          }
          return Math.abs(Math.hypot(p[0] - piece.center[0], p[1] - piece.center[1]) - piece.radius);
        }),
      );
      expect(nearest).toBeLessThan(0.0101);
    }
  });
});
