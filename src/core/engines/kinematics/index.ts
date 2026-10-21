import { jointDofs, type JointLimit, type JointType, type LimitHold, linkedValue, type ReachTarget, type Matrix4, type MotionFrame, type MotionLink, type MotionStudy, type PlaneFrame } from '@core/contracts';
import { transformPoint, type Vec3 } from '@core/utilities/math';
import { KinematicSolver } from './kinematic-solver';
import { simulate } from './simulation';

export interface KinematicInstance {
  readonly id: string;
  /** Used when no joint places the instance. */
  readonly transform: Matrix4;
  readonly grounded: boolean;
}

/** A joint with its frames already resolved to component coordinates. */
export interface KinematicJoint {
  readonly id: string;
  readonly type: JointType;
  readonly a: { readonly instance: string; readonly frame: PlaneFrame };
  readonly b: { readonly instance: string; readonly frame: PlaneFrame };
  readonly flip: boolean;
  /** mm and degrees, in the order of `jointDofs[type]`. */
  readonly values: readonly number[];
  readonly limits: readonly (JointLimit | null)[];
  /** Ball and universal joints: the largest angle between B's z and A's (degrees). */
  readonly cone?: number;
  /** Held at its values while other joints move (an actuator, CAD-195). */
  readonly driven?: boolean;
}

export interface KinematicModel {
  readonly instances: readonly KinematicInstance[];
  readonly joints: readonly KinematicJoint[];
  /** Joints that follow others; their freedoms are set from their drivers before solving. */
  readonly links?: readonly MotionLink[];
}

export interface KinematicSolution {
  readonly poses: ReadonlyMap<string, Matrix4>;
  /** Joint values after clamping to limits and closing loops. */
  readonly values: ReadonlyMap<string, readonly number[]>;
  /** Instances a joint places; only the others can be moved by hand. */
  readonly placed: ReadonlySet<string>;
  /** A joint that cannot be satisfied (a loop that does not close, a joint on one instance). */
  readonly error?: { readonly joint: string; readonly message: string };
  /** Where limits held joints (CAD-186). */
  readonly holds?: readonly LimitHold[];
  /** With targets (CAD-188): how far the worst one is from where it should be (mm, and degrees off). */
  readonly miss?: { readonly distance: number; readonly angle: number };
}

/**
 * Places assembly instances from their joints (docs/Architecture/Components.md#engines). Joints form
 * a spanning tree from the grounded instances, which places instances directly; joints that close a
 * loop are satisfied by adjusting the values of the other joints (damped least squares), keeping the
 * `driven` joints at their values. Pure and synchronous, like the Parameter Engine.
 */
export interface KinematicsEngine {
  /**
   * With `from` (the driven joints' earlier values), the driven joints move there in steps of at most
   * 5° or 2 mm, each step starting from the one before, as a motion study does: a closed loop keeps
   * its branch instead of landing in the solution nearest its old values, such as a slider-crank's
   * mirror pose with the piston through the crankcase (CAD-120).
   */
  solve(model: KinematicModel, driven?: ReadonlySet<string>, from?: ReadonlyMap<string, readonly number[]>): KinematicSolution;
  /**
   * Plays a motion study: joint values are interpolated between keys (evenly, or eased) and held
   * before the first and after the last; drives move at their speeds; the keyed, driven and linked
   * joints drive, and every frame is solved.
   */
  simulate(model: KinematicModel, study: MotionStudy, fps: number): KinematicSimulation;
  /**
   * Inverse kinematics (CAD-188): the joints leading to the targets' instances (and those closing
   * loops on the way) solved so the targets are met, starting from their values, within limits. The
   * joints in `hold` (and linked ones) keep their values; actuators move. A target out of reach gives
   * the nearest pose and how far off it is (`miss`).
   */
  reach(model: KinematicModel, targets: readonly ReachTarget[], hold?: ReadonlySet<string>): KinematicSolution;
  /**
   * What each actuator must hold in this pose (CAD-189), by virtual work: each of its freedoms moved
   * a little either way with the other actuators held, the masses' work against gravity (and their
   * accelerations). Actuators are the driven joints; without any, every joint of an open chain.
   */
  loads(model: KinematicModel, masses: readonly PointMass[], gravity: Vec3): { readonly loads: readonly JointLoad[]; readonly error?: string };
}

/** A mass at a point of an instance (kg, the instance's mm), and how fast that point speeds up (m/s²). */
export interface PointMass {
  readonly instance: string;
  readonly mass: number;
  readonly center: Vec3;
  readonly acceleration?: Vec3;
}

/** What a joint's freedom must hold (CAD-189): N·m for a turn, N for a slide, positive along the freedom. */
export interface JointLoad {
  readonly joint: string;
  readonly dof: number;
  readonly load: number;
}

export interface KinematicSimulation {
  readonly frames: readonly MotionFrame[];
  /** The first moment the joints cannot hold; frames stop there. */
  readonly error?: { readonly time: number; readonly joint: string; readonly message: string };
  /** The first moment each limit held a joint (CAD-186). */
  readonly holds?: readonly (LimitHold & { readonly time: number })[];
}

/**
 * The model with linked freedoms set from their drivers (chains in order, a few rounds deep), and
 * the joints that now drive.
 */
export function applyLinks(model: KinematicModel, driven: ReadonlySet<string>): { model: KinematicModel; driven: ReadonlySet<string> } {
  const links = model.links ?? [];
  if (!links.length) return { model, driven };
  const values = new Map(model.joints.map((j) => [j.id, [...j.values]]));
  const round = () => {
    for (const link of links) {
      const driver = values.get(link.driver.joint)?.[link.driver.dof];
      const target = values.get(link.driven.joint);
      if (driver === undefined || !target || link.driven.dof >= target.length) continue;
      target[link.driven.dof] = linkedValue(link, driver);
    }
  };
  // As many rounds as links: enough for the longest chain.
  links.forEach(round);
  return {
    model: { ...model, joints: model.joints.map((j) => ({ ...j, values: values.get(j.id) ?? j.values })) },
    driven: new Set([...driven, ...links.map((l) => l.driven.joint)]),
  };
}

/** Whether the joints close a loop: more joints between instances than a tree of them has. */
function hasLoops(model: KinematicModel): boolean {
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    for (let at = id, next = parent.get(at); ; at = next, next = parent.get(at)) if (next === undefined || next === at) return at;
  };
  for (const joint of model.joints) {
    const [a, b] = [root(joint.a.instance), root(joint.b.instance)];
    if (a === b) return true;
    parent.set(a, b);
  }
  return false;
}

/** The most a driven joint moves in one step of a solve from earlier values: degrees, or mm. */
const stepSize = { rotate: 5, translate: 2 };
const maxSteps = 720;

export function createKinematicsEngine(): KinematicsEngine {
  const once = (model: KinematicModel, asked: ReadonlySet<string>, targets: readonly ReachTarget[] = []) => {
    // Actuators hold, except where targets ask the joints to move (CAD-188).
    const driven = targets.length ? new Set(asked) : new Set([...asked, ...model.joints.filter((j) => j.driven).map((j) => j.id)]);
    const linked = applyLinks(model, driven);
    return new KinematicSolver(linked.model, linked.driven, targets).solve();
  };
  const solve = (model: KinematicModel, driven: ReadonlySet<string> = new Set(), from?: ReadonlyMap<string, readonly number[]>) => {
    const start = (joint: KinematicJoint) => (driven.has(joint.id) ? from?.get(joint.id) : undefined);
    const steps = Math.min(
      maxSteps,
      Math.ceil(Math.max(1, ...model.joints.flatMap((joint) => jointDofs[joint.type].map((dof, i) => Math.abs((joint.values[i] ?? 0) - (start(joint)?.[i] ?? joint.values[i] ?? 0)) / stepSize[dof.kind])))),
    );
    if (steps <= 1) return once(model, driven);
    // The driven joints along the way; the others from the step before.
    const at = (joint: KinematicJoint, t: number, solved?: KinematicSolution): KinematicJoint => {
      const begin = start(joint);
      if (!begin) return { ...joint, values: solved?.values.get(joint.id) ?? joint.values };
      return { ...joint, values: joint.values.map((v, i) => (begin[i] ?? v) + (v - (begin[i] ?? v)) * t) };
    };
    let solution = once({ ...model, joints: model.joints.map((j) => at(j, 0)) }, driven);
    for (let step = 1; step <= steps && !solution.error; step++) {
      const solved = solution;
      solution = once({ ...model, joints: model.joints.map((j) => at(j, step / steps, solved)) }, driven);
    }
    return solution;
  };
  const loads = (model: KinematicModel, masses: readonly PointMass[], gravity: Vec3) => {
    const flagged = model.joints.filter((j) => j.driven && jointDofs[j.type].length);
    const base = once(model, new Set());
    if (base.error) return { loads: [], error: base.error.message };
    const looped = hasLoops(model);
    if (!flagged.length && looped) return { loads: [], error: 'The assembly has closed loops: mark the joints that carry the load (its actuators) as driven.' };
    const actuated = (flagged.length ? flagged : model.joints.filter((j) => jointDofs[j.type].length)).map((j) => j.id);
    const held = new Set(actuated);
    const solved = model.joints.map((j) => ({ ...j, values: base.values.get(j.id) ?? j.values }));
    const centers = (poses: ReadonlyMap<string, Matrix4>) => masses.map((m) => (poses.get(m.instance) ? transformPoint(poses.get(m.instance) as Matrix4, m.center) : undefined));
    const result: JointLoad[] = [];
    for (const id of actuated) {
      const joint = solved.find((j) => j.id === id) as KinematicJoint;
      jointDofs[joint.type].forEach((dof, i) => {
        const step = 0.01; // degrees or mm
        const moved = (sign: number) => {
          const joints = solved.map((j) => (j.id === id ? { ...j, values: j.values.map((v, k) => (k === i ? v + sign * step : v)), limits: [] } : j));
          return once({ ...model, joints }, held);
        };
        const [up, down] = [moved(1), moved(-1)];
        if (up.error || down.error) return;
        const [a, b] = [centers(up.poses), centers(down.poses)];
        // Work per unit of the freedom: kg · m/s² · mm per mm (N) or per degree.
        let work = 0;
        masses.forEach((m, k) => {
          const [p, q] = [a[k], b[k]];
          if (!p || !q) return;
          const push = [0, 1, 2].map((n) => (m.acceleration?.[n] ?? 0) - (gravity[n] as number));
          work += m.mass * push.reduce((sum, v, n) => sum + v * (((p[n] as number) - (q[n] as number)) / (2 * step)), 0);
        });
        result.push({ joint: id, dof: i, load: dof.kind === 'rotate' ? (work * 180) / Math.PI / 1000 : work });
      });
    }
    return { loads: result };
  };
  return { solve, simulate: (model, study, fps) => simulate(model, study, fps, once), reach: (model, targets, hold = new Set()) => once(model, hold, targets), loads };
}
