import { jointDofs, type LimitHold, type Matrix4, type PlaneFrame, type ReachTarget } from '@core/contracts';
import {
  compose,
  fromFrame,
  invertRigid,
  rotation,
  rotationVector,
  translation,
  transformPoint,
  translationOf,
  type Vec3,
} from '@core/utilities/math';
import type { KinematicJoint, KinematicModel, KinematicSolution } from './index';

const degree = Math.PI / 180;
const unit: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Rotation errors are weighed like this many mm per radian, so both kinds of error count alike. */
const rotationWeight = 100;
const tolerance = 1e-7;

interface TreeStep {
  readonly joint: KinematicJoint;
  /** True when A is placed first and the joint places B. */
  readonly forward: boolean;
}

const frameMatrix = (f: PlaneFrame): Matrix4 => {
  const [u, v] = [f.u, f.v];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return fromFrame(f.origin, u, v, n);
};

const flipMatrix = (joint: KinematicJoint): Matrix4 => (joint.flip ? rotation([1, 0, 0], Math.PI) : rotation([1, 0, 0], 0));

/** The joint's motion for its values (mm, degrees), applied in the order of its degrees of freedom. */
function motion(joint: KinematicJoint, values: readonly number[]): Matrix4 {
  return compose(
    ...jointDofs[joint.type].map((dof, i) => {
      const value = values[i] ?? 0;
      const axis = unit[dof.axis] as Vec3;
      return dof.kind === 'translate' ? translation([axis[0] * value, axis[1] * value, axis[2] * value]) : rotation(axis, value * degree);
    }),
  );
}

/** The two turns whose cosines make the angle between B's z and A's: a ball's pitch and roll, a universal joint's two tilts. */
const coneDofs = (joint: KinematicJoint): readonly [number, number] | undefined =>
  joint.type === 'ball' ? [1, 2] : joint.type === 'universal' ? [0, 1] : undefined;

/** The angle (degrees) between B's z axis and A's for these values. */
export function tipAngle(joint: KinematicJoint, values: readonly number[]): number {
  const dofs = coneDofs(joint);
  if (!dofs) return 0;
  const cos = Math.cos((values[dofs[0]] ?? 0) * degree) * Math.cos((values[dofs[1]] ?? 0) * degree);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / degree;
}

/** The values within the limits and the cone: a cone scales both turns down together until B's z is on it. */
const clamp = (joint: KinematicJoint, values: readonly number[]): number[] => {
  const limited = jointDofs[joint.type].map((_, i) => {
    const value = values[i] ?? 0;
    const limit = joint.limits[i];
    return limit ? Math.min(limit.max, Math.max(limit.min, value)) : value;
  });
  const dofs = coneDofs(joint);
  if (!dofs || joint.cone === undefined || tipAngle(joint, limited) <= joint.cone) return limited;
  const scaled = (k: number) => limited.map((v, i) => (dofs.includes(i) ? v * k : v));
  let [low, high] = [0, 1];
  for (let step = 0; step < 50; step++) {
    const middle = (low + high) / 2;
    if (tipAngle(joint, scaled(middle)) > joint.cone) high = middle;
    else low = middle;
  }
  return scaled(low);
};

/** Where the limits hold the joints (CAD-186): past what was asked of the driven ones, or moved onto them by the loops. */
function holds(joints: readonly KinematicJoint[], values: ReadonlyMap<string, readonly number[]>, driven: ReadonlySet<string>): LimitHold[] {
  const found: LimitHold[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  for (const joint of joints) {
    const final = values.get(joint.id) ?? joint.values;
    jointDofs[joint.type].forEach((_, i) => {
      const limit = joint.limits[i];
      const [value, asked] = [final[i] ?? 0, joint.values[i] ?? 0];
      if (!limit || (near(value, asked) && asked >= limit.min && asked <= limit.max)) return;
      const at = near(value, limit.min) ? 'min' : near(value, limit.max) ? 'max' : undefined;
      if (at) found.push({ joint: joint.id, dof: i, at, value: limit[at], ...(driven.has(joint.id) && !near(value, asked) ? { asked } : {}) });
    });
    if (joint.cone === undefined || !coneDofs(joint)) continue;
    const [tip, askedTip] = [tipAngle(joint, final), tipAngle(joint, joint.values)];
    if (tip >= joint.cone - 1e-6 && (askedTip > joint.cone + 1e-6 || !near(tip, askedTip))) {
      found.push({ joint: joint.id, dof: 'cone', at: 'cone', value: joint.cone, ...(driven.has(joint.id) && askedTip > joint.cone + 1e-6 ? { asked: askedTip } : {}) });
    }
  }
  return found;
}

export class KinematicSolver {
  private readonly tree: TreeStep[] = [];
  private readonly loops: KinematicJoint[] = [];
  private readonly roots = new Map<string, Matrix4>();
  /** The tree step that places each instance, to follow an instance back to the ground. */
  private readonly placing = new Map<string, TreeStep>();
  private error: KinematicSolution['error'];

  constructor(
    private readonly model: KinematicModel,
    private readonly driven: ReadonlySet<string>,
    private readonly targets: readonly ReachTarget[] = [],
  ) {
    this.span();
  }

  solve(): KinematicSolution {
    const values = new Map(this.model.joints.map((j) => [j.id, clamp(j, j.values)]));
    if ((this.loops.length || this.targets.length) && !this.error) this.closeLoops(values);
    const poses = this.poses(values);
    for (const joint of this.loops) values.set(joint.id, this.loopValues(joint, poses));
    const placed = new Set(this.tree.map((s) => (s.forward ? s.joint.b.instance : s.joint.a.instance)));
    const held = holds(this.model.joints, values, this.driven);
    return { poses, values, placed, ...(held.length ? { holds: held } : {}), ...(this.targets.length ? { miss: this.miss(poses) } : {}), ...(this.error ? { error: this.error } : {}) };
  }

  /** The tree joints between the ground and these instances: those a target can move. */
  private chainTo(instances: Iterable<string>): Set<string> {
    const joints = new Set<string>();
    for (let instance of instances) {
      for (let step = this.placing.get(instance), guard = 0; step && guard <= this.tree.length; step = this.placing.get(instance), guard++) {
        joints.add(step.joint.id);
        instance = step.forward ? step.joint.a.instance : step.joint.b.instance;
      }
    }
    return joints;
  }

  /** How far each target is (mm, and its directions weighed like rotations). */
  private targetResidual(poses: ReadonlyMap<string, Matrix4>, directions = true): number[] {
    return this.targets.flatMap((target) => {
      const pose = poses.get(target.instance);
      if (!pose) return [];
      const point = transformPoint(pose, target.point ?? [0, 0, 0]);
      const direction = (pair: ReachTarget['axis']) => {
        if (!pair || !directions) return [];
        const got = unitOf(transformPoint(pose, pair.local).map((v, i) => v - (pose[12 + i] as number)));
        const want = unitOf(pair.along);
        return got.map((v, i) => (v - (want[i] as number)) * rotationWeight);
      };
      return [...point.map((v, i) => v - (target.at[i] as number)), ...direction(target.axis), ...direction(target.xAxis)];
    });
  }

  /** The worst target's distance (mm) and the angle (degrees) its directions are off. */
  private miss(poses: ReadonlyMap<string, Matrix4>): { distance: number; angle: number } {
    let [distance, angle] = [0, 0];
    for (const target of this.targets) {
      const pose = poses.get(target.instance);
      if (!pose) continue;
      const point = transformPoint(pose, target.point ?? [0, 0, 0]);
      distance = Math.max(distance, Math.hypot(...point.map((v, i) => v - (target.at[i] as number))));
      for (const pair of [target.axis, target.xAxis]) {
        if (!pair) continue;
        const got = unitOf(transformPoint(pose, pair.local).map((v, i) => v - (pose[12 + i] as number)));
        const want = unitOf(pair.along);
        const cos = got.reduce((sum, v, i) => sum + v * (want[i] as number), 0);
        angle = Math.max(angle, Math.acos(Math.max(-1, Math.min(1, cos))) / degree);
      }
    }
    return { distance, angle };
  }

  /** Breadth first from the grounded instances, then from the first instance of each unconnected group. */
  private span(): void {
    const known = new Set<string>();
    const queue: string[] = [];
    const visit = (id: string, transform: Matrix4) => {
      this.roots.set(id, transform);
      known.add(id);
      queue.push(id);
    };
    const used = new Set<string>();
    const drain = () => {
      while (queue.length) {
        const current = queue.shift() as string;
        for (const joint of this.model.joints) {
          if (used.has(joint.id) || (joint.a.instance !== current && joint.b.instance !== current)) continue;
          used.add(joint.id);
          if (joint.a.instance === joint.b.instance) {
            this.error ??= { joint: joint.id, message: 'A joint needs two different instances.' };
            continue;
          }
          const other = joint.a.instance === current ? joint.b.instance : joint.a.instance;
          if (known.has(other)) {
            this.loops.push(joint);
            continue;
          }
          const step = { joint, forward: joint.a.instance === current };
          this.tree.push(step);
          this.placing.set(other, step);
          known.add(other);
          queue.push(other);
        }
      }
    };
    for (const instance of this.model.instances) if (instance.grounded) visit(instance.id, instance.transform);
    drain();
    for (const instance of this.model.instances) {
      if (known.has(instance.id)) continue;
      visit(instance.id, instance.transform);
      drain();
    }
  }

  private poses(values: ReadonlyMap<string, readonly number[]>): Map<string, Matrix4> {
    const poses = new Map(this.roots);
    for (const { joint, forward } of this.tree) {
      const a = frameMatrix(joint.a.frame);
      const b = frameMatrix(joint.b.frame);
      const m = compose(motion(joint, values.get(joint.id) ?? []), flipMatrix(joint));
      if (forward) poses.set(joint.b.instance, compose(poses.get(joint.a.instance) as Matrix4, a, m, invertRigid(b)));
      else poses.set(joint.a.instance, compose(poses.get(joint.b.instance) as Matrix4, b, invertRigid(m), invertRigid(a)));
    }
    return poses;
  }

  /** B's frame relative to A's, with the flip taken out: a pure joint motion when the joint holds. */
  private relative(joint: KinematicJoint, poses: ReadonlyMap<string, Matrix4>): Matrix4 {
    const a = compose(poses.get(joint.a.instance) as Matrix4, frameMatrix(joint.a.frame));
    const b = compose(poses.get(joint.b.instance) as Matrix4, frameMatrix(joint.b.frame), invertRigid(flipMatrix(joint)));
    return compose(invertRigid(a), b);
  }

  /**
   * How far a loop joint is from holding: translations and rotations its type does not allow, a
   * universal joint's spin, and, for a driven joint, how far its values are from what it was set to.
   */
  private residual(joint: KinematicJoint, poses: ReadonlyMap<string, Matrix4>): number[] {
    const relative = this.relative(joint, poses);
    const dofs = jointDofs[joint.type];
    const t = translationOf(relative);
    const r = rotationVector(relative);
    const free = (kind: 'translate' | 'rotate', axis: number) => dofs.some((d) => d.kind === kind && d.axis === axis);
    const spin = joint.type === 'universal' ? [Math.atan2(-(relative[4] as number), relative[0] as number) * rotationWeight] : [];
    const got = this.driven.has(joint.id) ? this.loopValues(joint, poses) : undefined;
    const held = got ? dofs.map((dof, i) => ((got[i] as number) - (joint.values[i] ?? 0)) * (dof.kind === 'rotate' ? degree * rotationWeight : 1)) : [];
    return [
      ...[0, 1, 2].flatMap((axis) => [
        ...(free('translate', axis) ? [] : [t[axis] as number]),
        ...(free('rotate', axis) || dofs.filter((d) => d.kind === 'rotate').length > 1 ? [] : [(r[axis] as number) * rotationWeight]),
      ]),
      ...spin,
      ...held,
    ];
  }

  /** The values a loop joint ends up with, read back from where the loop put its two sides. */
  private loopValues(joint: KinematicJoint, poses: ReadonlyMap<string, Matrix4>): number[] {
    const m = this.relative(joint, poses);
    const at = (i: number) => m[i] as number;
    const t = translationOf(m);
    const asin = (x: number) => Math.asin(Math.max(-1, Math.min(1, x)));
    // A ball turns about z, y and x in turn; a universal joint about x, then y.
    const euler = joint.type === 'universal' ? [Math.atan2(-at(9), at(10)), asin(at(8)), 0] : [Math.atan2(at(6), at(10)), asin(-at(2)), Math.atan2(at(1), at(0))];
    return jointDofs[joint.type].map((dof) => (dof.kind === 'translate' ? (t[dof.axis] as number) : (euler[dof.axis] as number) / degree));
  }

  /**
   * Damped least squares (Levenberg–Marquardt) over the free values of the tree joints, closing the
   * loops and, with targets, meeting them: then only the joints leading to the targets' instances and
   * to the loops move.
   */
  private closeLoops(values: Map<string, readonly number[]>): void {
    const movable = this.targets.length
      ? this.chainTo([...this.targets.map((t) => t.instance), ...this.loops.flatMap((j) => [j.a.instance, j.b.instance])])
      : undefined;
    const unknowns = this.tree.flatMap(({ joint }) =>
      this.driven.has(joint.id) || (movable && !movable.has(joint.id)) ? [] : jointDofs[joint.type].map((dof, index) => ({ joint, index, scale: dof.kind === 'rotate' ? 1 / degree : 1 })),
    );
    const read = () => unknowns.map((u) => ((values.get(u.joint.id) ?? [])[u.index] ?? 0) / u.scale);
    const write = (x: readonly number[]) =>
      unknowns.forEach((u, k) => {
        const next = [...(values.get(u.joint.id) ?? [])];
        next[u.index] = (x[k] as number) * u.scale;
        values.set(u.joint.id, clamp(u.joint, next));
      });
    let directions = true;
    const residuals = () => {
      const poses = this.poses(values);
      return [...this.loops.flatMap((joint) => this.residual(joint, poses)), ...this.targetResidual(poses, directions)];
    };
    const norm = (r: readonly number[]) => Math.hypot(...r);
    // Far targets are reached in two stages: their points first, then their directions as well, so
    // the directions do not pull the joints into a corner on the way (CAD-188).
    const run = () => {
      if (this.targets.some((t) => t.axis || t.xAxis)) {
        directions = false;
        this.minimize(unknowns, read, write, residuals, norm, 300);
        directions = true;
      }
      this.minimize(unknowns, read, write, residuals, norm, this.targets.length ? 500 : 200);
    };
    const start = read();
    run();
    // A target missed from where the joints are (an arm held straight bends the wrong way first) is
    // tried again from a few nearby starts: every joint 20° (or 20 mm) one way, the other, alternating.
    if (this.targets.length && norm(residuals()) > 1e-6) {
      let best = { x: read(), score: norm(residuals()) };
      const seeds: ((k: number) => number)[] = [() => 1, () => -1, (k) => (k % 2 ? -1 : 1), (k) => (k % 2 ? 1 : -1)];
      for (const seed of seeds) {
        write(start.map((v, k) => v + seed(k) * ((unknowns[k] as { scale: number }).scale === 1 ? 20 : 20 * degree)));
        run();
        const score = norm(residuals());
        if (score < best.score - 1e-9) best = { x: read(), score };
        if (best.score <= 1e-6) break;
      }
      write(best.x);
    }
    // Targets may stay out of reach (the nearest pose is the answer); only loops that stay open fail.
    const open = this.loops.length ? norm(this.loops.flatMap((joint) => this.residual(joint, this.poses(values)))) : 0;
    if (open > 1e-4) {
      const worst = this.loops.find((joint) => norm(this.residual(joint, this.poses(values))) > 1e-4) ?? this.loops[0];
      // How far it stays open: mm, with rotations weighed as mm.
      const gap = worst ? norm(this.residual(worst, this.poses(values))) : 0;
      if (worst) this.error = { joint: worst.id, message: `The joints cannot all hold: this loop does not close with these values and limits (it stays ${gap < 0.01 ? gap.toExponential(1) : gap.toFixed(2)} mm open).` };
    }
  }

  /** Damped least squares from the values as they are, for at most `iterations` steps. */
  private minimize(
    unknowns: readonly { readonly scale: number }[],
    read: () => number[],
    write: (x: readonly number[]) => void,
    residuals: () => number[],
    norm: (r: readonly number[]) => number,
    iterations: number,
  ): void {
    let x = read();
    let r = residuals();
    let damping = 1e-3;
    for (let iteration = 0; iteration < iterations && norm(r) > tolerance && unknowns.length; iteration++) {
      const jacobian = unknowns.map((_, k) => {
        const step = 1e-6;
        const probe = [...x];
        probe[k] = (probe[k] as number) + step;
        write(probe);
        const shifted = residuals();
        return shifted.map((value, i) => (value - (r[i] as number)) / step);
      });
      write(x);
      // Normal equations: (JᵀJ + λ·diag(JᵀJ)) δ = −Jᵀr, columns of `jacobian` are ∂r/∂x_k.
      const n = unknowns.length;
      const jtj = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => dotRows(jacobian[i] as number[], jacobian[j] as number[])));
      const jtr = Array.from({ length: n }, (_, i) => -dotRows(jacobian[i] as number[], r));
      const delta = solveLinear(
        // A joint that does not move the residuals (a gripper turning about the target point) must not make it singular.
        jtj.map((row, i) => row.map((v, j) => (i === j ? v + damping * v + 1e-9 : v))),
        jtr,
      );
      if (!delta) break;
      // A step turns a joint at most 0.2 rad (11°) or moves it 20 mm, so a pose near a singular one
      // (an arm held straight) walks towards a far target instead of leaping into its limits.
      const largest = Math.max(1, ...delta.map((d, k) => Math.abs(d) / ((unknowns[k] as { scale: number }).scale === 1 ? 20 : 0.2)));
      const candidate = x.map((v, k) => v + (delta[k] as number) / largest);
      write(candidate);
      const next = residuals();
      if (norm(next) < norm(r)) {
        x = read(); // limits may have clamped the step
        r = next;
        damping = Math.max(damping / 3, 1e-9);
      } else {
        write(x);
        damping *= 4;
        if (damping > 1e8) break;
      }
    }
  }
}

const unitOf = (v: readonly number[]): number[] => {
  const length = Math.hypot(...v) || 1;
  return v.map((x) => x / length);
};

const dotRows = (a: readonly number[], b: readonly number[]) => a.reduce((sum, v, i) => sum + v * (b[i] as number), 0);

/** Gaussian elimination with partial pivoting; nothing when the system is singular. */
function solveLinear(matrix: number[][], rhs: number[]): number[] | undefined {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i] as number]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs((a[row] as number[])[col] as number) > Math.abs((a[pivot] as number[])[col] as number)) pivot = row;
    if (Math.abs((a[pivot] as number[])[col] as number) < 1e-14) return undefined;
    [a[col], a[pivot]] = [a[pivot] as number[], a[col] as number[]];
    const p = a[col] as number[];
    for (let row = col + 1; row < n; row++) {
      const target = a[row] as number[];
      const factor = (target[col] as number) / (p[col] as number);
      for (let k = col; k <= n; k++) target[k] = (target[k] as number) - factor * (p[k] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const r = a[row] as number[];
    let sum = r[n] as number;
    for (let k = row + 1; k < n; k++) sum -= (r[k] as number) * (x[k] as number);
    x[row] = sum / (r[row] as number);
  }
  return x;
}
