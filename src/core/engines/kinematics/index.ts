import type { JointLimit, JointType, Matrix4, MotionFrame, MotionStudy, PlaneFrame } from '@core/contracts';
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
   * Plays a motion study: joint values are interpolated linearly between keys (and held before the
   * first and after the last), the keyed joints drive, and every frame is solved.
   */
  simulate(model: KinematicModel, study: MotionStudy, fps: number): KinematicSimulation;
}

export interface KinematicSimulation {
  readonly frames: readonly MotionFrame[];
  /** The first moment the joints cannot hold; frames stop there. */
  readonly error?: { readonly time: number; readonly joint: string; readonly message: string };
}

export function createKinematicsEngine(): KinematicsEngine {
  const solve = (model: KinematicModel, driven: ReadonlySet<string> = new Set()) => new KinematicSolver(model, driven).solve();
  return { solve, simulate: (model, study, fps) => simulate(model, study, fps, solve) };
}
