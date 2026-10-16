import type { Appearance } from './appearance';
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
  /** Absent: shown in its bodies' own appearance. */
  readonly appearance?: Appearance;
  /** A configuration of the component (absent: its parameters' own values). */
  readonly configuration?: string;
}

/**
 * What an instance shows and where its result is kept: a component, or one configuration of it
 * (`<component>@<configuration>`).
 */
export const sourceKey = (component: string, configuration?: string): string => (configuration ? `${component}@${configuration}` : component);

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

/** Moves a joint origin away from what was picked: along the frame's axes (mm), then turned about its normal (degrees). */
export interface JointOffset {
  readonly translate: Vec3;
  readonly angle: number;
}

/** Where a joint attaches: a face or edge of the instance's component, or the component's origin, maybe moved by an offset. */
export interface JointOrigin {
  readonly instance: string;
  readonly ref?: TopologyRef;
  readonly offset?: JointOffset;
}

/** The frame moved by the offset: along its own axes, then turned about its normal. */
export function offsetFrame(frame: PlaneFrame, offset: JointOffset | undefined): PlaneFrame {
  if (!offset) return frame;
  const { origin, u, v } = frame;
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const [x, y, z] = offset.translate;
  const at = (i: 0 | 1 | 2) => origin[i] + u[i] * x + v[i] * y + n[i] * z;
  const a = (offset.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return {
    origin: [at(0), at(1), at(2)],
    u: [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
    v: [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s],
  };
}

/**
 * Copies of instances that follow them: in a row, around an axis, or mirrored across a plane. Copies
 * show the same component and move with their originals; they cannot carry joints.
 */
export interface InstancePattern {
  readonly id: string;
  readonly name: string;
  readonly kind: 'linear' | 'circular' | 'mirror';
  readonly instances: readonly string[];
  /** Linear: the direction of the row; circular: the axis; mirror: the plane's normal. */
  readonly direction: Vec3;
  /** Circular: a point on the axis; mirror: a point on the plane. */
  readonly origin: Vec3;
  /** Linear and circular: how many, the originals included. */
  readonly count: number;
  /** Linear: millimetres between copies; circular: degrees between copies. */
  readonly spacing: number;
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

/**
 * A joint's values at a moment of a motion study. Values between keys change evenly, or, with
 * `ease`, start and end slowly (on the way to this key).
 */
export interface MotionKey {
  readonly time: number;
  readonly joint: string;
  readonly values: readonly number[];
  readonly ease?: boolean;
}

/** A joint's freedom turned or moved at a constant speed (degrees or mm per second) from its value at the start. */
export interface MotionDrive {
  readonly joint: string;
  readonly dof: number;
  readonly speed: number;
}

export interface MotionStudy {
  readonly id: string;
  readonly name: string;
  /** Seconds. */
  readonly duration: number;
  readonly keys: readonly MotionKey[];
  /** Drives win over keys of the same joint. */
  readonly drives?: readonly MotionDrive[];
}

/** One freedom of a joint (its index in `jointDofs`). */
export interface JointFreedom {
  readonly joint: string;
  readonly dof: number;
}

/**
 * One joint's freedom follows another's: `driven = offset + ratio × driver`. Gears turn the other
 * way (a negative ratio, teeth over teeth), a rack moves π·d/360 mm per degree of its pinion, and a
 * belt turns its pulleys the same way (diameter over diameter).
 */
export interface MotionLink {
  readonly id: string;
  readonly name: string;
  readonly kind: 'gear' | 'rack' | 'belt';
  readonly driver: JointFreedom;
  readonly driven: JointFreedom;
  readonly ratio: number;
  readonly offset: number;
}

/** A step of an exploded view: instances moved apart along a direction (mm). */
export interface ExplodeStep {
  readonly id: string;
  readonly instances: readonly string[];
  readonly direction: Vec3;
  readonly distance: number;
}

/** Steps that take an assembly apart, one after the other: for exploded pictures and build instructions. */
export interface ExplodedView {
  readonly id: string;
  readonly name: string;
  readonly steps: readonly ExplodeStep[];
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
