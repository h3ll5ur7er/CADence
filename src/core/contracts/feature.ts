/**
 * Features: the 3D steps of a component's timeline (docs/Architecture/Document-model.md#features).
 * Numeric values are expressions, evaluated with the component's parameters.
 */

export type Vec3 = readonly [number, number, number];

/**
 * A face, edge or vertex, named by how it was made (feature, role, source curve) rather than by kernel
 * index; a vertex is named by the edges that meet there ({@link vertexName}). `hint` is where it was
 * when picked; it settles ties and helps repair lost references.
 */
export interface TopologyRef {
  readonly kind: 'face' | 'edge' | 'vertex';
  readonly body: string;
  readonly name: string;
  readonly hint?: Vec3;
}

/** The persistent name of a vertex: the names of the edges that meet there, in a fixed order. */
export const vertexName = (edgeNames: readonly string[]): string => `v:${[...new Set(edgeNames)].sort().join('&')}`;

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

/** Blends between profiles of two or more sketches, in order (their outer outlines). */
export interface LoftFeature extends FeatureBase {
  readonly type: 'loft';
  readonly sections: readonly { readonly sketch: string; readonly profile: string }[];
  /** Straight between the sections instead of smooth through them. */
  readonly ruled: boolean;
  readonly operation: BodyOperation;
}

/** Sweeps sketch profiles along a path: the curves of another sketch, joined end to end. */
export interface SweepFeature extends FeatureBase {
  readonly type: 'sweep';
  readonly sketch: string;
  readonly profiles: readonly string[];
  /** The sketch whose curves are the path. */
  readonly path: string;
  readonly operation: BodyOperation;
}

/** Repeats the effect of earlier features along a path (the curves of a sketch), evenly spaced. */
export interface PathPatternFeature extends FeatureBase {
  readonly type: 'path-pattern';
  readonly features: readonly string[];
  readonly path: string;
  readonly count: string;
  /** Turn the copies with the path, as it changes direction. */
  readonly align: boolean;
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

/**
 * A construction plane: offset from a base plane (an origin plane, a flat face or another construction
 * plane), turned about an axis in the base plane by an angle, halfway between two parallel planes, or
 * through three vertices. Planes without a `mode` are offset planes.
 */
export type PlaneFeature = FeatureBase & { readonly type: 'plane' } & (
    | { readonly mode?: 'offset'; readonly base: PlaneRef; readonly offset: string }
    | { readonly mode: 'angle'; readonly base: PlaneRef; readonly axis: AxisRef; readonly angle: string }
    | { readonly mode: 'midplane'; readonly base: PlaneRef; readonly second: PlaneRef }
    | { readonly mode: 'points'; readonly points: readonly TopologyRef[] }
  );

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

/** Brings the solids of an imported 3D file (STEP, STL, OBJ, 3MF) in as new bodies. */
export interface InsertFeature extends FeatureBase {
  readonly type: 'insert';
  /** The imported document. */
  readonly document: string;
}

/** Joins bodies into a target body, cuts them from it, or keeps only where they overlap it. */
export interface CombineFeature extends FeatureBase {
  readonly type: 'combine';
  readonly target: string;
  readonly tools: readonly string[];
  readonly operation: 'join' | 'cut' | 'intersect';
  /** Leave the tool bodies as they are; otherwise they are used up. */
  readonly keepTools: boolean;
}

/** Splits a body in two by a plane; the piece behind the plane becomes a new body. */
export interface SplitFeature extends FeatureBase {
  readonly type: 'split';
  readonly body: string;
  readonly plane: PlaneRef;
}

/** Moves or copies bodies: turned by `angle` about `axis`, then shifted by `translate` (x, y, z). */
export interface MoveFeature extends FeatureBase {
  readonly type: 'move';
  readonly bodies: readonly string[];
  readonly translate: readonly [string, string, string];
  readonly axis: AxisRef;
  readonly angle: string;
  readonly copy: boolean;
}

/** Scales bodies about the origin, the same in every direction. */
export interface ScaleFeature extends FeatureBase {
  readonly type: 'scale';
  readonly bodies: readonly string[];
  readonly factor: string;
}

export type Feature =
  | InsertFeature
  | LoftFeature
  | SweepFeature
  | PathPatternFeature
  | CombineFeature
  | SplitFeature
  | MoveFeature
  | ScaleFeature
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
export type ToolFeature = ExtrudeFeature | RevolveFeature | LoftFeature | SweepFeature;
export const isToolFeature = (f: { readonly type: string }): f is ToolFeature =>
  f.type === 'extrude' || f.type === 'revolve' || f.type === 'loft' || f.type === 'sweep';

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
