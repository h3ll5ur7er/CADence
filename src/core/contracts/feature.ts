/**
 * Features: the 3D steps of a component's timeline (docs/Architecture/Document-model.md#features).
 * Numeric values are expressions, evaluated with the component's parameters.
 */

export type Vec3 = readonly [number, number, number];

/**
 * A face or edge, named by how it was made (feature, role, source curve) rather than by kernel index.
 * `hint` is where it was when picked; it settles ties and helps repair lost references.
 */
export interface TopologyRef {
  readonly kind: 'face' | 'edge';
  readonly body: string;
  readonly name: string;
  readonly hint?: Vec3;
}

/** Where a sketch or a construction plane lies. */
export type PlaneRef =
  | 'XY'
  | 'XZ'
  | 'YZ'
  | { readonly face: TopologyRef }
  | { readonly plane: string };

/** An axis for revolving and circular patterns, or a direction for linear patterns. */
export type AxisRef =
  | { readonly kind: 'origin'; readonly axis: 'X' | 'Y' | 'Z' }
  | { readonly kind: 'sketch-line'; readonly sketch: string; readonly line: string }
  | { readonly kind: 'edge'; readonly edge: TopologyRef };

export type BodyOperation = 'new-body' | 'join' | 'cut' | 'intersect';

interface FeatureBase {
  readonly id: string;
  readonly name: string;
  readonly suppressed: boolean;
}

/** Extrudes sketch profiles along the sketch normal. */
export interface ExtrudeFeature extends FeatureBase {
  readonly type: 'extrude';
  readonly sketch: string;
  readonly profiles: readonly string[];
  readonly distance: string;
  readonly direction: 'normal' | 'reverse' | 'symmetric';
  readonly operation: BodyOperation;
}

/** Revolves sketch profiles around an axis. */
export interface RevolveFeature extends FeatureBase {
  readonly type: 'revolve';
  readonly sketch: string;
  readonly profiles: readonly string[];
  readonly axis: AxisRef;
  readonly angle: string;
  readonly operation: BodyOperation;
}

/** Rounds (fillet) or bevels (chamfer) edges. */
export interface EdgeTreatmentFeature extends FeatureBase {
  readonly type: 'fillet' | 'chamfer';
  readonly edges: readonly TopologyRef[];
  readonly size: string;
}

/** Hollows a body: the selected faces are removed, the walls get the given thickness (inward). */
export interface ShellFeature extends FeatureBase {
  readonly type: 'shell';
  readonly faces: readonly TopologyRef[];
  readonly thickness: string;
}

/** A construction plane offset from an origin plane, a planar face or another construction plane. */
export interface PlaneFeature extends FeatureBase {
  readonly type: 'plane';
  readonly base: PlaneRef;
  readonly offset: string;
}

/** Repeats the effect of earlier extrudes/revolves (holes, bosses) along a direction. */
export interface LinearPatternFeature extends FeatureBase {
  readonly type: 'linear-pattern';
  readonly features: readonly string[];
  readonly direction: AxisRef;
  readonly count: string;
  readonly spacing: string;
}

/** Repeats the effect of earlier extrudes/revolves around an axis, spread over `angle`. */
export interface CircularPatternFeature extends FeatureBase {
  readonly type: 'circular-pattern';
  readonly features: readonly string[];
  readonly axis: AxisRef;
  readonly count: string;
  readonly angle: string;
}

/** Mirrors the effect of earlier extrudes/revolves across a plane. */
export interface MirrorFeature extends FeatureBase {
  readonly type: 'mirror';
  readonly features: readonly string[];
  readonly plane: PlaneRef;
}

export type Feature =
  | ExtrudeFeature
  | RevolveFeature
  | EdgeTreatmentFeature
  | ShellFeature
  | PlaneFeature
  | LinearPatternFeature
  | CircularPatternFeature
  | MirrorFeature;

export type FeatureType = Feature['type'];

/** Features that make a tool solid and combine it with the bodies, and can therefore be patterned. */
export type ToolFeature = ExtrudeFeature | RevolveFeature;
export const isToolFeature = (f: { readonly type: string }): f is ToolFeature => f.type === 'extrude' || f.type === 'revolve';

/** A plane in space: origin and orthonormal in-plane axes (u, v); the normal is u × v. */
export interface PlaneFrame {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
}

export const originFrames: Readonly<Record<'XY' | 'XZ' | 'YZ', PlaneFrame>> = {
  XY: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] },
  XZ: { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1] },
  YZ: { origin: [0, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
};
