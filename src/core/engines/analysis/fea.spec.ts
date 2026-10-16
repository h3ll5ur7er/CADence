import type { Vec3 } from '@core/contracts';
import { describe, expect, it } from 'vitest';
import { type FeaInput, type FeaSurface, solveFea } from './fea';

/** A box's surface, two triangles a face, faces named by side: x0, x1, y0, y1, z0, z1. */
function boxSurface(min: Vec3, max: Vec3): FeaSurface {
  const positions: number[] = [];
  const indices: number[] = [];
  const faces: { name: string; start: number; count: number }[] = [];
  const corner = (x: number, y: number, z: number): number[] => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
  const quads: [string, number[][]][] = [
    ['x0', [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]]],
    ['x1', [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]]],
    ['y0', [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]]],
    ['y1', [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]]],
    ['z0', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]],
    ['z1', [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]]],
  ];
  for (const [name, quad] of quads) {
    const base = positions.length / 3;
    for (const [x, y, z] of quad) positions.push(...corner(x as number, y as number, z as number));
    faces.push({ name, start: indices.length, count: 6 });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), faces };
}

/** A 60 × 30 × 3 plate with a hole of radius 4 in the middle: faces x0 … z1 and `hole`. */
function plateWithHole(): Pick<FeaInput, 'surface' | 'inside' | 'box'> {
  const [w, h, t, r, cx, cy] = [60, 30, 3, 4, 30, 15];
  const positions: number[] = [];
  const indices: number[] = [];
  const faces: { name: string; start: number; count: number }[] = [];
  const face = (name: string, triangles: Vec3[][]) => {
    faces.push({ name, start: indices.length, count: triangles.length * 3 });
    for (const triangle of triangles)
      for (const p of triangle) {
        indices.push(positions.length / 3);
        positions.push(...p);
      }
  };
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => [
    [a, b, c],
    [a, c, d],
  ];
  // Angles round the hole, with the plate's corners among them, and where each meets the outline.
  const corners = [Math.atan2(-cy, -cx), Math.atan2(-cy, w - cx), Math.atan2(h - cy, w - cx), Math.atan2(h - cy, -cx)];
  const angles = [...Array.from({ length: 64 }, (_, k) => -Math.PI + (k * 2 * Math.PI) / 64), ...corners].sort((a, b) => a - b);
  const outline = (a: number): [number, number] => {
    const [dx, dy] = [Math.cos(a), Math.sin(a)];
    const s = Math.min(dx > 1e-12 ? (w - cx) / dx : dx < -1e-12 ? -cx / dx : Infinity, dy > 1e-12 ? (h - cy) / dy : dy < -1e-12 ? -cy / dy : Infinity);
    return [cx + dx * s, cy + dy * s];
  };
  const ring = (z: number, flip: boolean) =>
    angles.flatMap((a, k) => {
      const b = angles[(k + 1) % angles.length] as number;
      const [o1, o2] = [outline(a), outline(b)];
      const quadAt: Vec3[] = [[cx + r * Math.cos(a), cy + r * Math.sin(a), z], [...o1, z], [...o2, z], [cx + r * Math.cos(b), cy + r * Math.sin(b), z]];
      return quad(...((flip ? quadAt.reverse() : quadAt) as [Vec3, Vec3, Vec3, Vec3]));
    });
  face('z0', ring(0, true));
  face('z1', ring(t, false));
  face('hole', angles.flatMap((a, k) => {
    const b = angles[(k + 1) % angles.length] as number;
    const at = (angle: number, z: number): Vec3 => [cx + r * Math.cos(angle), cy + r * Math.sin(angle), z];
    return quad(at(a, 0), at(a, t), at(b, t), at(b, 0));
  }));
  face('x0', quad([0, 0, 0], [0, 0, t], [0, h, t], [0, h, 0]));
  face('x1', quad([w, 0, 0], [w, h, 0], [w, h, t], [w, 0, t]));
  face('y0', quad([0, 0, 0], [w, 0, 0], [w, 0, t], [0, 0, t]));
  face('y1', quad([0, h, 0], [0, h, t], [w, h, t], [w, h, 0]));
  return {
    surface: { positions: Float32Array.from(positions), indices: Uint32Array.from(indices), faces },
    inside: (p) => p[0] > 0 && p[0] < w && p[1] > 0 && p[1] < h && p[2] > 0 && p[2] < t && Math.hypot(p[0] - cx, p[1] - cy) > r,
    box: { min: [0, 0, 0], max: [w, h, t] },
  };
}

const steel = { modulus: 200_000, poisson: 0.3 };

function cantilever(size?: number): FeaInput {
  const min: Vec3 = [0, 0, 0];
  const max: Vec3 = [100, 10, 10];
  return {
    surface: boxSurface(min, max),
    inside: (p) => p.every((v, k) => v > (min[k] as number) && v < (max[k] as number)),
    box: { min, max },
    size,
    ...steel,
    fixed: new Set(['x0']),
    loads: [{ face: 'x1', kind: 'force', force: 100, direction: [0, 0, -1] }],
  };
}

const nodeValues = (out: ReturnType<typeof solveFea>, test: (p: Vec3) => boolean) =>
  Array.from({ length: out.positions.length / 3 }, (_, i) => i).filter((i) => test([out.positions[i * 3] as number, out.positions[i * 3 + 1] as number, out.positions[i * 3 + 2] as number]));

describe('solveFea', () => {
  it('bends a cantilever like beam theory: δ = FL³/3EI', { timeout: 30_000 }, () => {
    const out = solveFea(cantilever(2.5));
    // 100 N on a 100 × 10 × 10 steel beam: 0.2 mm (and a little more from shear).
    const tip = nodeValues(out, (p) => p[0] > 99.9);
    const deflection = tip.reduce((s, i) => s + (out.displacement[i * 3 + 2] as number), 0) / tip.length;
    expect(-deflection).toBeGreaterThan(0.19);
    expect(-deflection).toBeLessThan(0.22);
    // Bending stress halfway along, at the top and bottom: M c / I = 100 · 50 · 5 / 833 = 30 MPa.
    const middle = nodeValues(out, (p) => Math.abs(p[0] - 50) < 1e-3 && (p[2] < 1e-3 || p[2] > 10 - 1e-3) && p[1] > 2 && p[1] < 8);
    const stress = middle.reduce((s, i) => s + (out.stress[i] as number), 0) / middle.length;
    expect(stress).toBeGreaterThan(27);
    expect(stress).toBeLessThan(33);
    // Held where it is fixed.
    for (const i of nodeValues(out, (p) => p[0] < 1e-6)) expect(Math.hypot(...out.displacement.subarray(i * 3, i * 3 + 3))).toBe(0);
  });

  it('chooses an element size by itself and still bends about right', { timeout: 30_000 }, () => {
    const out = solveFea(cantilever());
    const tip = nodeValues(out, (p) => p[0] > 99.9);
    const deflection = -tip.reduce((s, i) => s + (out.displacement[i * 3 + 2] as number), 0) / tip.length;
    expect(deflection).toBeGreaterThan(0.17);
    expect(deflection).toBeLessThan(0.23);
  });

  it('presses with a pressure along the face normal', () => {
    // A 10 × 10 × 10 cube on its bottom, 1 MPa on top: 100 N down, strain p / E (a little less, held below).
    const min: Vec3 = [0, 0, 0];
    const max: Vec3 = [10, 10, 10];
    const out = solveFea({
      surface: boxSurface(min, max),
      inside: (p) => p.every((v, k) => v > (min[k] as number) && v < (max[k] as number)),
      box: { min, max },
      size: 2.5,
      ...steel,
      fixed: new Set(['z0']),
      loads: [{ face: 'z1', kind: 'pressure', pressure: 1 }],
    });
    const top = nodeValues(out, (p) => p[2] > 9.999);
    const dz = top.reduce((s, i) => s + (out.displacement[i * 3 + 2] as number), 0) / top.length;
    expect(dz).toBeLessThan(0);
    expect(-dz).toBeGreaterThan((0.8 * 10) / 200_000);
    expect(-dz).toBeLessThan((1.05 * 10) / 200_000);
    // Its surface faces out: the triangles enclose the cube's volume with a positive sign.
    const at = (n: number): Vec3 => [out.positions[n * 3] as number, out.positions[n * 3 + 1] as number, out.positions[n * 3 + 2] as number];
    let volume = 0;
    for (let t = 0; t < out.surface.length; t += 3) {
      const [a, b, c] = [at(out.surface[t] as number), at(out.surface[t + 1] as number), at(out.surface[t + 2] as number)];
      volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    expect(volume).toBeCloseTo(1000, 6);
  });

  it('raises the stress around a hole about as much as the handbooks say', () => {
    // A 60 × 30 × 3 plate with an 8 mm hole, pulled lengthwise: Peterson's Kt for d/W = 0.27 is 2.4 on the net section.
    const out = solveFea({ ...plateWithHole(), size: 1.5, ...steel, fixed: new Set(['x0']), loads: [{ face: 'x1', kind: 'force', force: 660, direction: [1, 0, 0] }] });
    const nominal = 660 / ((30 - 8) * 3);
    const edge = nodeValues(out, (p) => Math.abs(p[0] - 30) < 0.8 && Math.abs(Math.abs(p[1] - 15) - 4) < 0.3);
    const peak = Math.max(...edge.map((i) => out.stress[i] as number));
    expect(peak / nominal).toBeGreaterThan(2);
    expect(peak / nominal).toBeLessThan(3);
    // Boundary nodes sit on the hole, not on the grid.
    const onHole = nodeValues(out, (p) => Math.abs(Math.hypot(p[0] - 30, p[1] - 15) - 4) < 0.01);
    expect(onHole.length).toBeGreaterThan(20);
  }, 60_000);

  it('refuses a part held nowhere', () => {
    expect(() => solveFea({ ...cantilever(5), fixed: new Set() })).toThrow(/fixed/);
  });
});
