import { describe, expect, it } from 'vitest';
import { RayCaster } from './ray-caster';

/** Two unit squares (two triangles each) at z = 0 and z = 2, plus a far-away triangle. */
const positions = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
  0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 1, 2,
  50, 50, 50, 51, 50, 50, 50, 51, 50,
]);
const indices = new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10]);

describe('RayCaster', () => {
  const caster = new RayCaster(positions, indices);

  it('finds the nearest triangle along a ray', () => {
    expect(caster.cast([0.25, 0.5, 1], [0, 0, 1])).toBeCloseTo(1);
    expect(caster.cast([0.25, 0.5, 1], [0, 0, -1])).toBeCloseTo(1);
    expect(caster.cast([0.25, 0.5, -1], [0, 0, 1])).toBeCloseTo(1);
  });

  it('misses beside the triangles and behind the origin', () => {
    expect(caster.cast([2, 2, 1], [0, 0, 1])).toBeUndefined();
    expect(caster.cast([0.5, 0.5, 3], [0, 0, 1])).toBeUndefined();
  });

  it('ignores hits closer than the minimum distance', () => {
    expect(caster.cast([0.5, 0.25, 0], [0, 0, 1], 1e-4)).toBeCloseTo(2);
  });

  it('stays fast on large meshes', () => {
    const n = 200; // a 200 × 200 grid: 80,000 triangles
    const grid = new Float32Array((n + 1) * (n + 1) * 3);
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) grid.set([x, y, Math.sin(x / 10)], (y * (n + 1) + x) * 3);
    const tris: number[] = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * (n + 1) + x;
        tris.push(i, i + 1, i + n + 2, i, i + n + 2, i + n + 1);
      }
    const started = performance.now();
    const big = new RayCaster(grid, new Uint32Array(tris));
    let hits = 0;
    for (let k = 0; k < 80000; k++) if (big.cast([(k % n) + 0.3, Math.floor(k / n) % n + 0.6, 5], [0, 0, -1]) !== undefined) hits++;
    const elapsed = performance.now() - started;
    expect(hits).toBe(80000);
    expect(elapsed).toBeLessThan(2000);
  });
});
