import type { DocumentId } from './ids';
import type { PlaneFrame, TopologyRef, Vec3 } from './feature';

/** A rigid placement: 4 × 4, column-major (translation at 12, 13, 14), millimetres. */
export type Matrix4 = readonly number[];

/** A component placed in an assembly. */
export interface Instance {
  readonly id: string;
  readonly component: DocumentId;
  readonly name: string;
  /** Where the instance sits when no joint places it (grounded or free instances). */
  readonly transform: Matrix4;
  /** Grounded instances never move; joints position the others relative to them. */
  readonly grounded: boolean;
}

export type JointType = 'rigid' | 'revolute' | 'slider' | 'cylindrical' | 'pin-slot' | 'planar' | 'ball';

/** One freedom of a joint, along or about an axis of the joint frame. */
export interface JointDof {
  readonly kind: 'translate' | 'rotate';
  readonly axis: 0 | 1 | 2;
  readonly label: string;
}

/**
 * What each joint type lets move; a joint's `values` follow this order (mm for translations, degrees
 * for rotations), and the motions apply in this order.
 */
export const jointDofs: Readonly<Record<JointType, readonly JointDof[]>> = {
  rigid: [],
  revolute: [{ kind: 'rotate', axis: 2, label: 'Angle' }],
  slider: [{ kind: 'translate', axis: 2, label: 'Distance' }],
  cylindrical: [
    { kind: 'rotate', axis: 2, label: 'Angle' },
    { kind: 'translate', axis: 2, label: 'Distance' },
  ],
  'pin-slot': [
    { kind: 'translate', axis: 0, label: 'Slide' },
    { kind: 'rotate', axis: 2, label: 'Angle' },
  ],
  planar: [
    { kind: 'translate', axis: 0, label: 'X' },
    { kind: 'translate', axis: 1, label: 'Y' },
    { kind: 'rotate', axis: 2, label: 'Angle' },
  ],
  ball: [
    { kind: 'rotate', axis: 2, label: 'Yaw' },
    { kind: 'rotate', axis: 1, label: 'Pitch' },
    { kind: 'rotate', axis: 0, label: 'Roll' },
  ],
};

/** Where a joint attaches: a face or edge of the instance's component, or the component's origin. */
export interface JointOrigin {
  readonly instance: string;
  readonly ref?: TopologyRef;
}

export interface JointLimit {
  readonly min: number;
  readonly max: number;
}

/**
 * Connects two instances: B's joint frame is placed on A's, turned over when `flip` is set, then
 * moved by the joint's values. A is the side nearer the ground.
 */
export interface Joint {
  readonly id: string;
  readonly name: string;
  readonly type: JointType;
  readonly a: JointOrigin;
  readonly b: JointOrigin;
  readonly flip: boolean;
  readonly values: readonly number[];
  /** Per degree of freedom; `null` for unlimited. */
  readonly limits: readonly (JointLimit | null)[];
}

/** A joint's values at a moment of a motion study; values between keys are interpolated linearly. */
export interface MotionKey {
  readonly time: number;
  readonly joint: string;
  readonly values: readonly number[];
}

export interface MotionStudy {
  readonly id: string;
  readonly name: string;
  /** Seconds. */
  readonly duration: number;
  readonly keys: readonly MotionKey[];
}

/** A joint frame in component coordinates: the plane frame's normal is the joint axis (z). */
export type JointFrame = PlaneFrame;

/** Placements of all instances at one moment. */
export interface MotionFrame {
  readonly time: number;
  readonly poses: Readonly<Record<string, Matrix4>>;
}

/** Two instances whose solids overlap. */
export interface Interference {
  readonly a: string;
  readonly b: string;
  /** Overlapping volume, mm³. */
  readonly volume: number;
  readonly center: Vec3;
}
