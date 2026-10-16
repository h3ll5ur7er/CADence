import { type JointLimit, type JointType, linkedValue, type Matrix4, type MotionFrame, type MotionLink, type MotionStudy, type PlaneFrame } from '@core/contracts';
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
}

/**
 * Places assembly instances from their joints (docs/Architecture/Components.md#engines). Joints form
 * a spanning tree from the grounded instances, which places instances directly; joints that close a
 * loop are satisfied by adjusting the values of the other joints (damped least squares), keeping the
 * `driven` joints at their values. Pure and synchronous, like the Parameter Engine.
 */
export interface KinematicsEngine {
  solve(model: KinematicModel, driven?: ReadonlySet<string>): KinematicSolution;
  /**
   * Plays a motion study: joint values are interpolated between keys (evenly, or eased) and held
   * before the first and after the last; drives move at their speeds; the keyed, driven and linked
   * joints drive, and every frame is solved.
   */
  simulate(model: KinematicModel, study: MotionStudy, fps: number): KinematicSimulation;
}

export interface KinematicSimulation {
  readonly frames: readonly MotionFrame[];
  /** The first moment the joints cannot hold; frames stop there. */
  readonly error?: { readonly time: number; readonly joint: string; readonly message: string };
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

export function createKinematicsEngine(): KinematicsEngine {
  const solve = (model: KinematicModel, driven: ReadonlySet<string> = new Set()) => {
    const linked = applyLinks(model, driven);
    return new KinematicSolver(linked.model, linked.driven).solve();
  };
  return { solve, simulate: (model, study, fps) => simulate(model, study, fps, solve) };
}
