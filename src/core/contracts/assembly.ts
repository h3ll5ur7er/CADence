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

export type JointType = 'rigid' | 'revolute' | 'slider' | 'cylindrical' | 'pin-slot' | 'planar' | 'ball' | 'universal';

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
  // Two crossing axes and no spin, as at a cardan joint or a leg's end (CAD-197).
  universal: [
    { kind: 'rotate', axis: 0, label: 'Tilt X' },
    { kind: 'rotate', axis: 1, label: 'Tilt Y' },
  ],
};

/** The joints whose turning a cone limit can hold: B's z axis within `cone` degrees of A's. */
export const coneJoints: ReadonlySet<JointType> = new Set<JointType>(['ball', 'universal']);

/**
 * Moves a joint origin away from what was picked: along the frame's axes (mm), then tilted about its
 * own x axis (degrees, CAD-113), then turned about its normal (degrees).
 */
export interface JointOffset {
  readonly translate: Vec3;
  readonly angle: number;
  /** Turns the frame about its normal before the tilt: which way the tilt tips the axis (CAD-118). */
  readonly lean?: number;
  /** Tips the joint's axis over, about the frame's x axis: a joint along a direction no face has. */
  readonly tilt?: number;
  /**
   * The joint's axis as a direction in the instance's coordinates instead of lean and tilt (CAD-185),
   * and which way the frame's x points (projected across the axis; absent: the picked frame's x, or
   * the nearest other axis). The angle still turns the frame about the axis.
   */
  readonly axis?: Vec3;
  readonly xAxis?: Vec3;
  /**
   * Expressions of the project's parameters the values follow (CAD-185): `x`, `y`, `z` (lengths),
   * `lean`, `tilt`, `angle` (angles). The numbers above are what they were last evaluated to.
   */
  readonly expressions?: Readonly<Partial<Record<OffsetField, string>>>;
}

/** The offset's values that can follow an expression. */
export type OffsetField = 'x' | 'y' | 'z' | 'lean' | 'tilt' | 'angle';
export const offsetFields: readonly OffsetField[] = ['x', 'y', 'z', 'lean', 'tilt', 'angle'];

/** Where a joint attaches: a face or edge of the instance's component, or the component's origin, maybe moved by an offset. */
export interface JointOrigin {
  readonly instance: string;
  readonly ref?: TopologyRef;
  readonly offset?: JointOffset;
}

/**
 * The frame moved by the offset: along its own axes, turned about its normal (lean), tilted about its
 * new x axis, then turned about its new normal (angle). Lean and tilt together point the joint axis
 * any way.
 */
export function offsetFrame(frame: PlaneFrame, offset: JointOffset | undefined): PlaneFrame {
  if (!offset) return frame;
  const { origin } = frame;
  const n0: Vec3 = [frame.u[1] * frame.v[2] - frame.u[2] * frame.v[1], frame.u[2] * frame.v[0] - frame.u[0] * frame.v[2], frame.u[0] * frame.v[1] - frame.u[1] * frame.v[0]];
  const [x, y, z] = offset.translate;
  const at = (i: 0 | 1 | 2) => origin[i] + frame.u[i] * x + frame.v[i] * y + n0[i] * z;
  if (offset.axis) return axisFrame([at(0), at(1), at(2)], offset.axis, offset.xAxis ?? frame.u, offset.angle);
  const l = ((offset.lean ?? 0) * Math.PI) / 180;
  const u: Vec3 = [0, 1, 2].map((i) => (frame.u[i] as number) * Math.cos(l) + (frame.v[i] as number) * Math.sin(l)) as unknown as Vec3;
  const v0: Vec3 = [0, 1, 2].map((i) => (frame.v[i] as number) * Math.cos(l) - (frame.u[i] as number) * Math.sin(l)) as unknown as Vec3;
  // The tilt turns v towards the normal, about u.
  const t = ((offset.tilt ?? 0) * Math.PI) / 180;
  const v: Vec3 = [v0[0] * Math.cos(t) + n0[0] * Math.sin(t), v0[1] * Math.cos(t) + n0[1] * Math.sin(t), v0[2] * Math.cos(t) + n0[2] * Math.sin(t)];
  const a = (offset.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return {
    origin: [at(0), at(1), at(2)],
    u: [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s],
    v: [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s],
  };
}

/** A frame at `origin` whose normal is `axis`, its x towards `x` (or the nearest other axis), turned by `angle` degrees about the normal. */
function axisFrame(origin: Vec3, axis: Vec3, x: Vec3, angle: number): PlaneFrame {
  const unitOf = (v: readonly number[]): Vec3 => {
    const length = Math.hypot(v[0] as number, v[1] as number, v[2] as number);
    return [(v[0] as number) / length, (v[1] as number) / length, (v[2] as number) / length];
  };
  const n = unitOf(axis);
  const across = (v: Vec3): readonly number[] => {
    const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    return [v[0] - d * n[0], v[1] - d * n[1], v[2] - d * n[2]];
  };
  // The x given, or the world axis most across the normal when it lies along it.
  let u0 = across(x);
  if (Math.hypot(...u0) < 1e-9) u0 = across(([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]).reduce((best, e) => (Math.abs(e[0] * n[0] + e[1] * n[1] + e[2] * n[2]) < Math.abs(best[0] * n[0] + best[1] * n[1] + best[2] * n[2]) ? e : best)));
  const u = unitOf(u0);
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const a = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return { origin, u: [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s], v: [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s] };
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
  /**
   * An actuator (CAD-195): moving or solving other joints never changes its values; only setting
   * them does. A parallel mechanism's legs are driven, so their lengths set its pose.
   */
  readonly driven?: boolean;
  /** Ball and universal joints: the largest angle (degrees) between B's z axis and A's, any way (CAD-197). */
  readonly cone?: number;
}

/** Where a limit held a joint (CAD-186): a freedom at its minimum or maximum, or a cone at its angle. */
export interface LimitHold {
  readonly joint: string;
  /** The freedom's index in `jointDofs`, or `cone`. */
  readonly dof: number | 'cone';
  readonly at: 'min' | 'max' | 'cone';
  /** What it was held at (mm or degrees). */
  readonly value: number;
  /** What was asked, when the joint was asked to go past it. */
  readonly asked?: number;
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

/**
 * Where an instance should be (CAD-188): a point of it (its coordinates; its origin when absent) at a
 * place in the assembly, and optionally which way its directions point. The joints leading to it are
 * solved for (inverse kinematics), within their limits.
 */
export interface ReachTarget {
  readonly instance: string;
  readonly point?: Vec3;
  readonly at: Vec3;
  /** A direction of the instance (its coordinates) and the direction it should point in the assembly. */
  readonly axis?: { readonly local: Vec3; readonly along: Vec3 };
  /** A second direction, across the first: fixes the turn about it (a gripper's jaw). */
  readonly xAxis?: { readonly local: Vec3; readonly along: Vec3 };
}

/** A target at a moment of a study: the instance moves in a straight line between its targets (evenly, or eased into this one). */
export interface MotionTarget extends ReachTarget {
  readonly time: number;
  readonly ease?: boolean;
}

/**
 * An instance carried by another from a moment on (CAD-187): it keeps where it was relative to its
 * carrier, and is let go where it is at `until` (absent: carried to the end).
 */
export interface MotionCarry {
  readonly instance: string;
  readonly by: string;
  readonly from: number;
  readonly until?: number;
}

export interface MotionStudy {
  readonly id: string;
  readonly name: string;
  /** Seconds. */
  readonly duration: number;
  readonly keys: readonly MotionKey[];
  /** Drives win over keys of the same joint. */
  readonly drives?: readonly MotionDrive[];
  /** Where instances should be at moments; the joints leading to them follow (CAD-188). */
  readonly targets?: readonly MotionTarget[];
  /** Instances picked up and put down by others (CAD-187). */
  readonly carries?: readonly MotionCarry[];
}

/** One freedom of a joint (its index in `jointDofs`). */
export interface JointFreedom {
  readonly joint: string;
  readonly dof: number;
}

/**
 * One joint's freedom follows another's: `driven = offset + ratio × driver`. Gears turn the other
 * way (a negative ratio, teeth over teeth), a rack moves π·d/360 mm per degree of its pinion, and a
 * belt turns its pulleys the same way (diameter over diameter). Bevel gears turn like gears (teeth
 * over teeth, CAD-160); a worm turns its wheel starts over teeth of its turn. In a planetary set with its ring
 * fixed, the sun drives the carrier and each planet on it ({@link planetaryRatios}). A cam moves its
 * follower by its profile: `driven = offset + ratio × lift(driver)` ({@link linkedValue}).
 */
export interface MotionLink {
  readonly id: string;
  readonly name: string;
  readonly kind: 'gear' | 'bevel' | 'worm' | 'rack' | 'belt' | 'carrier' | 'planet' | 'cam';
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
  /** Every joint's values at this moment (CAD-196). */
  readonly values?: Readonly<Record<string, readonly number[]>>;
}

/** Two instances whose solids overlap. */
export interface Interference {
  readonly a: string;
  readonly b: string;
  /** Overlapping volume, mm³. */
  readonly volume: number;
  readonly center: Vec3;
}
