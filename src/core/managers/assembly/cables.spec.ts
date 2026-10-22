import type { BodyMesh, Cable, Matrix4 } from '@core/contracts';
import { identity, translation } from '@core/utilities/math';
import { describe, expect, it } from 'vitest';
import { cableMesh, cableRoute, insideMesh } from './cables';

const cable = (points: Cable['points'], extra: Partial<Cable> = {}): Cable => ({ id: 'c', name: 'Cable 1', diameter: 6, points, ...extra });

/** A closed cube from 0 to 10 along each axis, as triangles. */
function cube(): BodyMesh {
  const v = [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0, 0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 10, 10];
  const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { body: 'b', key: 'k', positions: Float32Array.from(v), normals: new Float32Array(v.length), indices: Uint32Array.from(t), faces: [], edgePositions: new Float32Array(), edges: [] };
}

describe('cables (CAD-192)', () => {
  it('runs straight between two points that face each other, and follows the parts', () => {
    const straight = cable([
      { instance: 'a', point: [0, 0, 0], direction: [1, 0, 0] },
      { instance: 'b', point: [0, 0, 0], direction: [1, 0, 0] },
    ]);
    const poses = new Map<string, Matrix4>([['a', identity()], ['b', translation([100, 0, 0])]]);
    const route = cableRoute(straight, poses);
    expect(route?.length).toBeCloseTo(100, 6);
    expect(route?.bendRadius).toBe(Infinity);
    // The part moves: the cable follows.
    expect(cableRoute(straight, new Map([['a', identity()], ['b', translation([0, 80, 0])]]))?.length).toBeGreaterThan(80);
    expect(cableRoute(straight, new Map([['a', identity()]]))).toBeUndefined();
  });

  it('bends round a corner about as tightly as a quarter circle would', () => {
    // Leaves along x, arrives going up y, 50 mm each way: roughly a quarter circle of 50 mm.
    const corner = cable([
      { instance: 'a', point: [0, 0, 0], direction: [1, 0, 0] },
      { instance: 'a', point: [50, 50, 0], direction: [0, 1, 0] },
    ]);
    const route = cableRoute(corner, new Map([['a', identity()]]));
    expect(route?.length).toBeGreaterThan(70);
    expect(route?.length).toBeLessThan(85);
    expect(route?.bendRadius).toBeGreaterThan(20);
    expect(route?.bendRadius).toBeLessThan(60);
    const tube = cableMesh(corner, route as NonNullable<typeof route>);
    expect(tube.indices.length % 3).toBe(0);
    expect(tube.positions.length / 3).toBe((route?.samples.length ?? 0) * 10);
  });

  it('tells points inside a closed mesh from points outside', () => {
    expect(insideMesh(cube(), [5, 5, 5])).toBe(true);
    expect(insideMesh(cube(), [15, 5, 5])).toBe(false);
    expect(insideMesh(cube(), [5, 5, -1])).toBe(false);
  });
});
