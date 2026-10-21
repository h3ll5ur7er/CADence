import { type BodyMesh, fail, type Material, ok, type Result, type SimulationResult, type SimulationSetup, type SimulationSurface, type Vec3 } from '@core/contracts';
import { FeaError, type FeaOutput, solveFea } from './fea';
import { RayCaster } from './ray-caster';

/** Skewed directions, so rays rarely run along edges; a point is inside when most of them say so. */
const rays: readonly Vec3[] = [
  [0.5773, 0.5774, 0.5775],
  [-0.6121, 0.4472, -0.6521],
  [0.2673, -0.8018, 0.5345],
];

/**
 * A linear static strength check (CAD-93) of the bodies that faces are held on, each on its own (they
 * do not touch each other), from their display meshes.
 */
export function simulate(meshes: readonly BodyMesh[], setup: SimulationSetup, material: Material, byBody: Readonly<Record<string, Material>> = {}): Result<SimulationResult> {
  const held = meshes.filter((m) => setup.fixed.some((f) => f.body === m.body));
  // Each body of its own material (CAD-158).
  const of = (body: string) => byBody[body] ?? material;
  const soft = held.map((m) => of(m.body)).find((m) => !m.youngsModulus || m.poisson === undefined);
  if (soft) return fail({ code: 'no-elasticity', message: `${soft.name} has no stiffness to calculate with.` });
  if (!held.length) return fail({ code: 'not-fixed', message: 'Hold at least one face fixed.' });
  const loose = setup.loads.find((l) => !held.some((m) => m.body === l.face.body));
  if (loose) return fail({ code: 'not-fixed', message: 'Every loaded body needs a fixed face too.' });
  if (!setup.loads.length) return fail({ code: 'no-loads', message: 'Add a force or a pressure.' });

  const solved: { mesh: BodyMesh; out: FeaOutput; material: Material }[] = [];
  try {
    for (const mesh of held) {
      const caster = new RayCaster(mesh.positions, mesh.indices);
      const out = solveFea({
        surface: mesh,
        inside: (p) => rays.filter((d) => caster.crossings(p, d) % 2 === 1).length >= 2,
        box: bounds(mesh.positions),
        size: setup.size,
        modulus: of(mesh.body).youngsModulus as number,
        poisson: of(mesh.body).poisson as number,
        fixed: new Set(setup.fixed.filter((f) => f.body === mesh.body).map((f) => f.name)),
        loads: setup.loads.filter((l) => l.face.body === mesh.body).map((l) => ({ ...l, face: l.face.name })),
      });
      solved.push({ mesh, out, material: of(mesh.body) });
    }
  } catch (error) {
    if (error instanceof FeaError) return fail({ code: 'simulation', message: error.message });
    throw error;
  }

  let maxStress = 0;
  let maxStressAt: Vec3 = [0, 0, 0];
  let maxDisplacement = 0;
  // The safety factor is the smallest of the bodies': each one's yield strength over its own largest stress.
  let safetyFactor: number | undefined;
  for (const { out, material: own } of solved) {
    const peak = out.stress.reduce((m, s) => Math.max(m, s), 0);
    if (own.yieldStrength && peak > 0) safetyFactor = Math.min(safetyFactor ?? Infinity, own.yieldStrength / peak);
  }
  for (const { out } of solved)
    for (let i = 0; i < out.stress.length; i++) {
      const s = out.stress[i] as number;
      if (s > maxStress) {
        maxStress = s;
        maxStressAt = [out.positions[i * 3] as number, out.positions[i * 3 + 1] as number, out.positions[i * 3 + 2] as number];
      }
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(out.displacement[i * 3] as number, out.displacement[i * 3 + 1] as number, out.displacement[i * 3 + 2] as number));
    }
  const join = (pick: (out: FeaOutput) => Float32Array) => {
    const all = new Float32Array(solved.reduce((n, s) => n + pick(s.out).length, 0));
    let offset = 0;
    for (const { out } of solved) {
      all.set(pick(out), offset);
      offset += pick(out).length;
    }
    return all;
  };
  return ok({
    maxStress,
    maxStressAt,
    maxDisplacement,
    ...(safetyFactor === undefined ? {} : { safetyFactor }),
    elements: solved.reduce((n, s) => n + s.out.elements, 0),
    nodes: solved.reduce((n, s) => n + s.out.stress.length, 0),
    bodies: solved.map(({ mesh, out }) => surfaceOf(mesh.body, out)),
    mesh: { positions: join((o) => o.positions), displacement: join((o) => o.displacement), stress: join((o) => o.stress) },
  });
}

function bounds(positions: Float32Array): { min: Vec3; max: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  positions.forEach((v, i) => {
    const k = i % 3;
    min[k] = Math.min(min[k] as number, v);
    max[k] = Math.max(max[k] as number, v);
  });
  return { min, max };
}

/** The solution's surface on its own: the nodes it uses, renumbered, with their results. */
function surfaceOf(body: string, out: FeaOutput): SimulationSurface {
  const index = new Map<number, number>();
  const indices = Uint32Array.from(out.surface, (n) => {
    let i = index.get(n);
    if (i === undefined) {
      i = index.size;
      index.set(n, i);
    }
    return i;
  });
  const positions = new Float32Array(index.size * 3);
  const displacement = new Float32Array(index.size * 3);
  const stress = new Float32Array(index.size);
  for (const [n, i] of index) {
    positions.set(out.positions.subarray(n * 3, n * 3 + 3), i * 3);
    displacement.set(out.displacement.subarray(n * 3, n * 3 + 3), i * 3);
    stress[i] = out.stress[n] as number;
  }
  return { body, positions, indices, stress, displacement };
}
