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

/**
 * Moves a joint origin away from what was picked: along the frame's axes (mm), then tilted about its
 * own x axis (degrees, CAD-113), then turned about its normal (degrees).
 */
export interface JointOffset {
  readonly translate: Vec3;
  readonly angle: number;
  /** Tips the joint's axis over, about the frame's x axis: a joint along a direction no face has. */
  readonly tilt?: number;
}

/** Where a joint attaches: a face or edge of the instance's component, or the component's origin, maybe moved by an offset. */
export interface JointOrigin {
  readonly instance: string;
  readonly ref?: TopologyRef;
  readonly offset?: JointOffset;
}

/** The frame moved by the offset: along its own axes, tilted about its x axis, then turned about its normal. */
export function offsetFrame(frame: PlaneFrame, offset: JointOffset | undefined): PlaneFrame {
  if (!offset) return frame;
  const { origin, u } = frame;
  const n0: Vec3 = [u[1] * frame.v[2] - u[2] * frame.v[1], u[2] * frame.v[0] - u[0] * frame.v[2], u[0] * frame.v[1] - u[1] * frame.v[0]];
  const [x, y, z] = offset.translate;
  const at = (i: 0 | 1 | 2) => origin[i] + u[i] * x + frame.v[i] * y + n0[i] * z;
  // The tilt turns v towards the normal, about u.
  const t = ((offset.tilt ?? 0) * Math.PI) / 180;
  const v: Vec3 = [frame.v[0] * Math.cos(t) + n0[0] * Math.sin(t), frame.v[1] * Math.cos(t) + n0[1] * Math.sin(t), frame.v[2] * Math.cos(t) + n0[2] * Math.sin(t)];
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
 * belt turns its pulleys the same way (diameter over diameter). In a planetary set with its ring
 * fixed, the sun drives the carrier and each planet on it ({@link planetaryRatios}). A cam moves its
 * follower by its profile: `driven = offset + ratio × lift(driver)` ({@link linkedValue}).
 */
export interface MotionLink {
  readonly id: string;
  readonly name: string;
  readonly kind: 'gear' | 'rack' | 'belt' | 'carrier' | 'planet' | 'cam';
  readonly driver: JointFreedom;
  readonly driven: JointFreedom;
  readonly ratio: number;
  readonly offset: number;
  /**
   * A cam's profile: the follower's lift (mm, or degrees for a turning follower) at angles of the
   * cam (degrees, 0 to 360, increasing), over one turn and round again; smooth between the points.
   */
  readonly profile?: readonly (readonly [number, number])[];
}

/**
 * A cam profile's lift at an angle: a smooth periodic curve through its points that keeps their shape
 * (monotone cubic, Fritsch–Carlson): it never dips below a flat stretch or overshoots a peak (CAD-112).
 */
export function camLift(profile: readonly (readonly [number, number])[], angle: number): number {
  const n = profile.length;
  if (n < 2) return profile[0]?.[1] ?? 0;
  const a = ((angle % 360) + 360) % 360;
  // The points continued round: point k + n is point k a turn later.
  const at = (k: number): readonly [number, number] => {
    const [x, y] = profile[((k % n) + n) % n] as readonly [number, number];
    return [x + 360 * Math.floor(k / n), y];
  };
  const slope = (k: number) => (at(k + 1)[1] - at(k)[1]) / (at(k + 1)[0] - at(k)[0]);
  // A point's tangent: zero where the curve turns or is flat on either side, else a harmonic mean of the slopes.
  const tangent = (k: number) => {
    const [before, after] = [slope(k - 1), slope(k)];
    if (before * after <= 0) return 0;
    const [h0, h1] = [at(k)[0] - at(k - 1)[0], at(k + 1)[0] - at(k)[0]];
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / before + (h1 + 2 * h0) / after);
  };
  let k = -1;
  while (k + 1 < n && at(k + 1)[0] <= a) k++;
  const [p1, p2] = [at(k), at(k + 1)];
  const span = p2[0] - p1[0];
  const t = (a - p1[0]) / span;
  const [m1, m2] = [tangent(k) * span, tangent(k + 1) * span];
  const [t2, t3] = [t * t, t * t * t];
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
}

/** Where a link puts its driven freedom, for a value of its driver. */
export function linkedValue(link: MotionLink, driver: number): number {
  return link.offset + link.ratio * (link.kind === 'cam' && link.profile?.length ? camLift(link.profile, driver) : driver);
}

/** A step of an exploded view: instances moved apart along a direction (mm). */
export interface ExplodeStep {
  readonly id: string;
  /** Instances, or pattern copies by their ids (`<pattern>/<instance>/<n>`). */
  readonly instances: readonly string[];
  readonly direction: Vec3;
  readonly distance: number;
  /**
   * Each part moves straight away from the axis along `direction` through `origin` (default the
   * origin) instead of along it: a circular pattern comes apart in one step.
   */
  readonly radial?: boolean;
  readonly origin?: Vec3;
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
