import { jointDofs, type Matrix4, type PlaneFrame } from '@core/contracts';
import {
  compose,
  fromFrame,
  invertRigid,
  rotation,
  rotationVector,
  translation,
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

const clamp = (joint: KinematicJoint, values: readonly number[]): number[] =>
  jointDofs[joint.type].map((_, i) => {
    const value = values[i] ?? 0;
    const limit = joint.limits[i];
    return limit ? Math.min(limit.max, Math.max(limit.min, value)) : value;
  });

export class KinematicSolver {
  private readonly tree: TreeStep[] = [];
  private readonly loops: KinematicJoint[] = [];
  private readonly roots = new Map<string, Matrix4>();
  private error: KinematicSolution['error'];

  constructor(
    private readonly model: KinematicModel,
    private readonly driven: ReadonlySet<string>,
  ) {
    this.span();
  }

  solve(): KinematicSolution {
    const values = new Map(this.model.joints.map((j) => [j.id, clamp(j, j.values)]));
    if (this.loops.length && !this.error) this.closeLoops(values);
    const poses = this.poses(values);
    for (const joint of this.loops) values.set(joint.id, this.loopValues(joint, poses));
    const placed = new Set(this.tree.map((s) => (s.forward ? s.joint.b.instance : s.joint.a.instance)));
    return { poses, values, placed, ...(this.error ? { error: this.error } : {}) };
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
          this.tree.push({ joint, forward: joint.a.instance === current });
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

  /** How far a loop joint is from holding: translations and rotations its type does not allow. */
  private residual(joint: KinematicJoint, poses: ReadonlyMap<string, Matrix4>): number[] {
    const relative = this.relative(joint, poses);
    const dofs = jointDofs[joint.type];
    const t = translationOf(relative);
    const r = rotationVector(relative);
    const free = (kind: 'translate' | 'rotate', axis: number) => dofs.some((d) => d.kind === kind && d.axis === axis);
    return [0, 1, 2].flatMap((axis) => [
      ...(free('translate', axis) ? [] : [t[axis] as number]),
      ...(free('rotate', axis) || dofs.filter((d) => d.kind === 'rotate').length > 1 ? [] : [(r[axis] as number) * rotationWeight]),
    ]);
  }

  /** The values a loop joint ends up with, read back from where the loop put its two sides. */
  private loopValues(joint: KinematicJoint, poses: ReadonlyMap<string, Matrix4>): number[] {
    const m = this.relative(joint, poses);
    const at = (i: number) => m[i] as number;
    const t = translationOf(m);
    const euler = [Math.atan2(at(6), at(10)), Math.asin(Math.max(-1, Math.min(1, -at(2)))), Math.atan2(at(1), at(0))];
    return jointDofs[joint.type].map((dof) => (dof.kind === 'translate' ? (t[dof.axis] as number) : (euler[dof.axis] as number) / degree));
  }

  /** Damped least squares (Levenberg–Marquardt) over the free values of the tree joints. */
  private closeLoops(values: Map<string, readonly number[]>): void {
    const unknowns = this.tree.flatMap(({ joint }) =>
      this.driven.has(joint.id) ? [] : jointDofs[joint.type].map((dof, index) => ({ joint, index, scale: dof.kind === 'rotate' ? 1 / degree : 1 })),
    );
    const read = () => unknowns.map((u) => ((values.get(u.joint.id) ?? [])[u.index] ?? 0) / u.scale);
    const write = (x: readonly number[]) =>
      unknowns.forEach((u, k) => {
        const next = [...(values.get(u.joint.id) ?? [])];
        next[u.index] = (x[k] as number) * u.scale;
        values.set(u.joint.id, clamp(u.joint, next));
      });
    const residuals = () => {
      const poses = this.poses(values);
      return this.loops.flatMap((joint) => this.residual(joint, poses));
    };
    const norm = (r: readonly number[]) => Math.hypot(...r);

    let x = read();
    let r = residuals();
    let damping = 1e-3;
    for (let iteration = 0; iteration < 200 && norm(r) > tolerance && unknowns.length; iteration++) {
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
        jtj.map((row, i) => row.map((v, j) => (i === j ? v + damping * (v + 1e-9) : v))),
        jtr,
      );
      if (!delta) break;
      const candidate = x.map((v, k) => v + (delta[k] as number));
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
    if (norm(r) > 1e-4) {
      const worst = this.loops.find((joint) => norm(this.residual(joint, this.poses(values))) > 1e-4) ?? this.loops[0];
      if (worst) this.error = { joint: worst.id, message: 'The joints cannot all hold: this loop does not close with these values and limits.' };
    }
  }
}

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
