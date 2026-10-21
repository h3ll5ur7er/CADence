import { describe, expect, it } from 'vitest';
import { decimate } from './decimate';
import { repairMesh, simplifyMeshes } from './mesh-repair';
import { meshVolume } from './solids';
import { scan } from './testing';

/** A 10 mm cube centred on the origin, outward triangles. */
const cube = () => {
  const positions = [-5, -5, -5, 5, -5, -5, 5, 5, -5, -5, 5, -5, -5, -5, 5, 5, -5, 5, 5, 5, 5, -5, 5, 5];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { name: 'Cube', positions, indices };
};

const openings = (indices: readonly number[]) => {
  const count = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [indices[t + k] as number, indices[t + ((k + 1) % 3)] as number];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  }
  return [...count.values()].filter((n) => n === 1).length;
};

describe('mesh repair (CAD-169)', () => {
  it('leaves a sound mesh as it was', () => {
    const { mesh, repair } = repairMesh(cube());
    expect(repair).toEqual({ mergedVertices: 0, removedTriangles: 0, flippedTriangles: 0, closedHoles: 0 });
    expect(mesh.indices).toEqual(cube().indices);
  });

  it('merges repeated corners, drops repeated triangles, turns triangles the right way and closes openings', () => {
    const broken = cube();
    // A repeated corner (vertex 8 = vertex 6), a repeated triangle, one triangle turned over, and one missing.
    broken.positions.push(5, 5, 5);
    broken.indices.splice(6, 3, 4, 5, 8);
    broken.indices.push(0, 2, 1);
    [broken.indices[13], broken.indices[14]] = [broken.indices[14] as number, broken.indices[13] as number];
    broken.indices.splice(33, 3);
    const { mesh, repair } = repairMesh(broken);
    expect(repair.mergedVertices).toBe(1);
    expect(repair.removedTriangles).toBe(1);
    expect(repair.flippedTriangles).toBe(1);
    expect(repair.closedHoles).toBe(1);
    expect(openings(mesh.indices)).toBe(0);
    expect(meshVolume(mesh.positions, mesh.indices)).toBeCloseTo(1000, 6);
  });

  it('turns a mesh that faces inwards outwards', () => {
    const inside = cube();
    for (let t = 0; t < inside.indices.length; t += 3) [inside.indices[t + 1], inside.indices[t + 2]] = [inside.indices[t + 2] as number, inside.indices[t + 1] as number];
    const { mesh, repair } = repairMesh(inside);
    expect(repair.flippedTriangles).toBe(12);
    expect(meshVolume(mesh.positions, mesh.indices)).toBeCloseTo(1000, 6);
  });

  it('closes a large opening with a fan', () => {
    const ball = scan(20, 24);
    const open = { ...ball, indices: ball.indices.slice(0, ball.indices.length - 24 * 3) };
    const { mesh, repair } = repairMesh(open);
    expect(repair.closedHoles).toBe(1);
    expect(openings(mesh.indices)).toBe(0);
    expect(meshVolume(mesh.positions, mesh.indices)).toBeGreaterThan(0.9 * meshVolume(ball.positions, ball.indices));
  });
});

describe('decimation (CAD-169)', () => {
  it('simplifies a ball to the budget and keeps its shape', () => {
    const ball = scan(60, 80);
    const before = ball.indices.length / 3;
    const simple = decimate(ball, 1000);
    expect(simple.indices.length / 3).toBeLessThanOrEqual(1000);
    expect(simple.indices.length / 3).toBeGreaterThan(900);
    expect(openings(simple.indices)).toBe(0);
    expect(meshVolume(simple.positions, simple.indices) / meshVolume(ball.positions, ball.indices)).toBeCloseTo(1, 2);
    expect(before).toBeGreaterThan(9000);
  });

  it('keeps an opening along its border', () => {
    const ball = scan(30, 40);
    const open = { ...ball, indices: ball.indices.slice(0, ball.indices.length / 2) };
    const simple = decimate(open, 300);
    // Points along the cut stay on its plane: the outline is kept, not eaten away.
    expect(simple.indices.length / 3).toBeLessThanOrEqual(300);
    expect(Math.min(...simple.positions.filter((_, i) => i % 3 === 2))).toBeCloseTo(-20, 0);
  });

  it('makes a 500,000-triangle scan small enough to become a solid', () => {
    const big = scan(501, 500);
    expect(big.indices.length / 3).toBeGreaterThan(499_000);
    const started = performance.now();
    const { meshes, repair, triangles } = simplifyMeshes([big], 20_000);
    const seconds = (performance.now() - started) / 1000;
    expect(triangles).toBeLessThanOrEqual(20_000);
    expect(triangles).toBeGreaterThan(18_000);
    expect(repair.closedHoles).toBe(0);
    expect(openings((meshes[0] as { indices: number[] }).indices)).toBe(0);
    expect(meshVolume((meshes[0] as { positions: number[] }).positions, (meshes[0] as { indices: number[] }).indices) / ((4 / 3) * Math.PI * 20 ** 3)).toBeCloseTo(1, 2);
    expect(seconds).toBeLessThan(30);
  }, 60_000);
});
