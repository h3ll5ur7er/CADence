import type { FitClass, PartSpec } from './parts';

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
  /**
   * A flat face. `anchor` is where the frame's origin and u axis were when the sketch was made
   * (CAD-136): kept when the face grows or shrinks, while the plane follows the face. Without it,
   * the frame sits at the face's centre (sketches made before phase 33).
   */
  | { readonly face: TopologyRef; readonly anchor?: { readonly origin: Vec3; readonly u: Vec3 } }
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
  /** Why the feature is there, for whoever edits the model next. */
  readonly note?: string;
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

/** Holes drilled at points of a sketch, into the material (against the sketch's normal). */
export interface HoleFeature extends FeatureBase {
  readonly type: 'hole';
  readonly sketch: string;
  readonly points: readonly string[];
  readonly kind: 'simple' | 'counterbore' | 'countersink';
  readonly diameter: string;
  readonly extent: 'through' | 'blind';
  /** For blind holes. */
  readonly depth: string;
  readonly boreDiameter: string;
  readonly boreDepth: string;
  readonly sinkDiameter: string;
  readonly sinkAngle: string;
  /** Print-friendly: a pointed top for holes that lie on their side, so they print without support. */
  readonly teardrop: boolean;
  /** Print-friendly: one layer left over the hole at the bottom of a counterbore, drilled out after printing. */
  readonly bridge: boolean;
  /** How tightly what goes in fits: its allowance (and the printer's hole compensation) widens the hole. */
  readonly fit?: FitClass;
}

/** A part (standard, gear or for printing) at points of a sketch, on its plane (contracts/parts.ts). */
export interface PartFeature extends FeatureBase {
  readonly type: 'part';
  readonly part: PartSpec;
  readonly sketch: string;
  readonly points: readonly string[];
  /** Turned about the plane's normal. */
  readonly angle: string;
  /** Mirrored to the other side of the plane. */
  readonly flip: boolean;
  readonly operation: BodyOperation;
}

/** An ISO metric thread on a round face: a hole (inside) or a shaft (outside), shown as a marker or modelled. */
export interface ThreadFeature extends FeatureBase {
  readonly type: 'thread';
  readonly face: TopologyRef;
  /** A size of {@link metricThreads}, such as `M6`. */
  readonly size: string;
  /** An expression, or empty for the whole face. */
  readonly length: string;
  readonly modelled: boolean;
  /** Start at the other end of the face. */
  readonly flip: boolean;
}

/** ISO metric coarse threads: major diameter and pitch (mm). */
export const metricThreads: Readonly<Record<string, { readonly diameter: number; readonly pitch: number }>> = {
  M2: { diameter: 2, pitch: 0.4 },
  'M2.5': { diameter: 2.5, pitch: 0.45 },
  M3: { diameter: 3, pitch: 0.5 },
  M4: { diameter: 4, pitch: 0.7 },
  M5: { diameter: 5, pitch: 0.8 },
  M6: { diameter: 6, pitch: 1 },
  M8: { diameter: 8, pitch: 1.25 },
  M10: { diameter: 10, pitch: 1.5 },
  M12: { diameter: 12, pitch: 1.75 },
  M16: { diameter: 16, pitch: 2 },
  M20: { diameter: 20, pitch: 2.5 },
};

/** Where a thread is, for showing it: from its start along `direction`, on a round face of `radius`. */
export interface ThreadMarker {
  readonly feature: string;
  readonly size: string;
  readonly origin: Vec3;
  readonly direction: Vec3;
  readonly radius: number;
  readonly length: number;
  readonly pitch: number;
  /** The thread's major (nominal) diameter. */
  readonly diameter: number;
  readonly internal: boolean;
}

/**
 * The flat sheet a sheet metal part starts from: sketch profiles extruded by the sheet's thickness. It
 * holds the component's sheet metal rules, which its edge flanges and flat pattern use.
 */
export interface BaseFlangeFeature extends FeatureBase {
  readonly type: 'base-flange';
  readonly sketch: string;
  readonly profiles: readonly string[];
  readonly direction: 'normal' | 'reverse';
  readonly thickness: string;
  readonly bendRadius: string;
  /** Where the neutral layer lies in the sheet, from the inside of a bend (0) to the outside (1). */
  readonly kFactor: string;
}

/** Flanges bent up from straight edges of the base flange: a bend, then a straight piece. */
export interface EdgeFlangeFeature extends FeatureBase {
  readonly type: 'edge-flange';
  readonly edges: readonly TopologyRef[];
  readonly length: string;
  readonly angle: string;
}

/** Where an edge flange stands, for unfolding: its edge, the directions away from and above the sheet. */
export interface FlangeMarker {
  readonly feature: string;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly away: Vec3;
  readonly up: Vec3;
  readonly length: number;
  /** Radians. */
  readonly angle: number;
}

/** Rounds (fillet) or bevels (chamfer) edges. */
export interface EdgeTreatmentFeature extends FeatureBase {
  readonly type: 'fillet' | 'chamfer';
  readonly edges: readonly TopologyRef[];
  readonly size: string;
  /** Fillets only: a radius at the far end of each edge, changing evenly from `size` (empty: the same all along). */
  readonly endSize?: string;
}

/** Tilts faces by an angle away from the pull direction (the normal of a neutral plane), hinged on that plane. */
export interface DraftFeature extends FeatureBase {
  readonly type: 'draft';
  readonly faces: readonly TopologyRef[];
  readonly plane: PlaneRef;
  readonly angle: string;
}

/** A rib: the curves of a sketch thickened and extruded along the sketch's normal, joined to what it touches. */
export interface RibFeature extends FeatureBase {
  readonly type: 'rib';
  readonly sketch: string;
  readonly thickness: string;
  readonly depth: string;
  readonly direction: 'normal' | 'reverse' | 'symmetric';
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
  | PartFeature
  | InsertFeature
  | BaseFlangeFeature
  | EdgeFlangeFeature
  | DraftFeature
  | RibFeature
  | HoleFeature
  | ThreadFeature
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
/** Features whose tool patterns and mirrors can repeat: tool features and holes. */
export const isRepeatable = (f: { readonly type: string }): f is ToolFeature | HoleFeature | RibFeature => isToolFeature(f) || f.type === 'hole' || f.type === 'rib';

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
