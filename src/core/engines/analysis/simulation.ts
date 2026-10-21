import { type BodyMesh, fail, type Material, ok, type Result, type SimulationLoad, type SimulationResult, type SimulationSetup, type SimulationSurface, type Vec3 } from '@core/contracts';
import { FeaError, type FeaInput, type FeaOutput, solveFea } from './fea';
import { RayCaster } from './ray-caster';

/** Skewed directions, so rays rarely run along edges; a point is inside when most of them say so. */
const rays: readonly Vec3[] = [
  [0.5773, 0.5774, 0.5775],
  [-0.6121, 0.4472, -0.6521],
  [0.2673, -0.8018, 0.5345],
];

/**
 * A linear static strength check (CAD-93) of the bodies that faces are held on, each on its own (they
 * do not touch each other), from their display meshes. Without a size, the elements are small enough
 * for the held and loaded faces (CAD-190); the check is run again with elements half as large again,
 * so the answer says how settled it is.
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
  if (!setup.loads.length && !setup.gravity) return fail({ code: 'no-loads', message: 'Add a force, a pressure, a moment or the weight.' });

  const size = setup.size && setup.size > 0 ? setup.size : Math.max(...held.map((mesh) => defaultSize(mesh, setup)));
  const solveAt = (at: number) => {
    const solved: { mesh: BodyMesh; out: FeaOutput; material: Material }[] = [];
    for (const mesh of held) {
      const caster = new RayCaster(mesh.positions, mesh.indices);
      const own = of(mesh.body);
      const out = solveFea({
        surface: mesh,
        inside: (p) => rays.filter((d) => caster.crossings(p, d) % 2 === 1).length >= 2,
        box: bounds(mesh.positions),
        size: at,
        modulus: own.youngsModulus as number,
        poisson: own.poisson as number,
        fixed: new Set(setup.fixed.filter((f) => f.body === mesh.body).map((f) => f.name)),
        loads: setup.loads.filter((l) => l.face.body === mesh.body).map((l) => feaLoad(l)),
        // g/cm³ → kg/mm³
        ...(setup.gravity ? { density: own.density * 1e-6, gravity: setup.gravity } : {}),
      });
      solved.push({ mesh, out, material: own });
    }
    return solved;
  };

  let solved: ReturnType<typeof solveAt>;
  let coarser: ReturnType<typeof solveAt> | undefined;
  try {
    solved = solveAt(size);
    try {
      coarser = solveAt(size * 1.5);
    } catch (error) {
      if (!(error instanceof FeaError)) throw error;
    }
  } catch (error) {
    if (error instanceof FeaError) return fail({ code: 'simulation', message: error.message });
    throw error;
  }

  const peakOf = (all: ReturnType<typeof solveAt>) => {
    let [stress, at, displacement] = [0, [0, 0, 0] as Vec3, 0];
    for (const { out } of all)
      for (let i = 0; i < out.stress.length; i++) {
        const s = out.stress[i] as number;
        if (s > stress) [stress, at] = [s, [out.positions[i * 3] as number, out.positions[i * 3 + 1] as number, out.positions[i * 3 + 2] as number]];
        displacement = Math.max(displacement, Math.hypot(out.displacement[i * 3] as number, out.displacement[i * 3 + 1] as number, out.displacement[i * 3 + 2] as number));
      }
    return { stress, at, displacement };
  };
  const peak = peakOf(solved);
  // The safety factor is the smallest of the bodies': each one's yield strength over its own largest stress.
  let safetyFactor: number | undefined;
  for (const { out, material: own } of solved) {
    const top = out.stress.reduce((m, s) => Math.max(m, s), 0);
    if (own.yieldStrength && top > 0) safetyFactor = Math.min(safetyFactor ?? Infinity, own.yieldStrength / top);
  }
  const notes: string[] = [];
  // A peak in a small spot, far above the stress a little away from it: a sharp corner, where the stress has no finite value.
  let away = 0;
  for (const { out } of solved)
    for (let i = 0; i < out.stress.length; i++) {
      const p: Vec3 = [out.positions[i * 3] as number, out.positions[i * 3 + 1] as number, out.positions[i * 3 + 2] as number];
      if (Math.hypot(p[0] - peak.at[0], p[1] - peak.at[1], p[2] - peak.at[2]) > 2 * size) away = Math.max(away, out.stress[i] as number);
    }
  if (away > 0 && peak.stress > 1.5 * away) {
    notes.push(`The largest stress, ${round(peak.stress)} MPa, is in a small spot; ${round(2 * size)} mm from it, the stress is at most ${round(away)} MPa. At a sharp inside corner the stress has no finite value: round the corner for a figure to trust.`);
  }
  const rough = coarser && peakOf(coarser);
  const change = rough && peak.stress > 0 ? Math.abs(peak.stress - rough.stress) / peak.stress : undefined;
  if (change !== undefined && change > 0.1) {
    notes.push(`The answer is not settled: with elements of ${round(size * 1.5)} mm the largest stress is ${round(rough?.stress as number)} MPa, ${Math.round(change * 100)} % off. Choose smaller elements (size) until it changes little.`);
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
    maxStress: peak.stress,
    maxStressAt: peak.at,
    maxDisplacement: peak.displacement,
    ...(safetyFactor === undefined ? {} : { safetyFactor }),
    size,
    ...(rough ? { coarser: { size: size * 1.5, maxStress: rough.stress, maxDisplacement: rough.displacement }, settled: (change ?? 0) <= 0.1 } : {}),
    ...(notes.length ? { notes } : {}),
    elements: solved.reduce((n, s) => n + s.out.elements, 0),
    nodes: solved.reduce((n, s) => n + s.out.stress.length, 0),
    bodies: solved.map(({ mesh, out }) => surfaceOf(mesh.body, out)),
    mesh: { positions: join((o) => o.positions), displacement: join((o) => o.displacement), stress: join((o) => o.stress) },
  });
}

const round = (value: number) => Math.round(value * 100) / 100;

/** A load as the solver takes it: moments in N·mm, a moment about an axis as a vector. */
function feaLoad(load: SimulationLoad): FeaInput['loads'][number] {
  if (load.kind === 'moment') {
    const length = Math.hypot(...load.axis) || 1;
    return { kind: 'moment', face: load.face.name, moment: load.axis.map((v) => (v / length) * load.moment * 1000) as unknown as Vec3 };
  }
  if (load.kind === 'remote') return { kind: 'remote', face: load.face.name, point: load.point, force: load.force, ...(load.moment ? { moment: load.moment.map((v) => v * 1000) as unknown as Vec3 } : {}) };
  return { ...load, face: load.face.name };
}

/**
 * The element size for a body (CAD-190): about 800 cubes for the body, but at least three across the
 * smallest held or loaded face, and no more cubes than the solver takes in good time.
 */
function defaultSize(mesh: BodyMesh, setup: SimulationSetup): number {
  const box = bounds(mesh.positions);
  const extent = [0, 1, 2].map((k) => (box.max[k] as number) - (box.min[k] as number));
  const volume = extent.reduce((a, b) => a * b, 1);
  const auto = Math.min(Math.cbrt(volume / 800), Math.min(...extent) / 2);
  const names = new Set([...setup.fixed.filter((f) => f.body === mesh.body).map((f) => f.name), ...setup.loads.filter((l) => l.face.body === mesh.body).map((l) => l.face.name)]);
  let smallest = Infinity;
  for (const face of mesh.faces) {
    if (!names.has(face.name)) continue;
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let i = face.start; i < face.start + face.count; i++) {
      const v = (mesh.indices[i] as number) * 3;
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k] as number, mesh.positions[v + k] as number);
        high[k] = Math.max(high[k] as number, mesh.positions[v + k] as number);
      }
    }
    // A flat face has one extent near zero: its smallest other extent counts.
    const sides = low.map((l, k) => (high[k] as number) - l).filter((d) => d > 1e-6);
    if (sides.length) smallest = Math.min(smallest, Math.min(...sides));
  }
  const floor = Math.cbrt(volume / 120_000);
  return Math.max(floor, Math.min(auto, smallest / 3));
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
