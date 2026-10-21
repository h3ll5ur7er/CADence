import type {
  BodyDifference,
  BodyMesh,
  BodyOperation,
  BodyState,
  CornerRelief,
  FlangeMarker,
  HelixPath,
  HemStyle,
  Matrix4,
  PlaneFrame,
  Profile,
  Result,
  ThreadMarker,
  TopologyRef,
  Vec2,
  Vec3,
} from '@core/contracts';
import type { ViewGeometry, ViewRequest } from './drawing-view';
import type { HoleSpec } from './holes';

import type { PartSolid } from './parts';
export type { HoleSpec };

export type { BodyState };

/** An axis given in world coordinates, or by a straight edge of a body. */
export type AxisInput = { readonly origin: Vec3; readonly direction: Vec3 } | { readonly edge: TopologyRef };

/** A piece of a sweep path in world coordinates: a line, an arc through `mid`, or a cubic Bézier. */
export type PathPiece =
  | { readonly kind: 'line'; readonly start: Vec3; readonly end: Vec3 }
  | { readonly kind: 'arc'; readonly start: Vec3; readonly mid: Vec3; readonly end: Vec3 }
  | { readonly kind: 'bezier'; readonly points: readonly [Vec3, Vec3, Vec3, Vec3] };

/** A helix as a sweep path (CAD-161). */
export type HelixPiece = { readonly kind: 'helix' } & HelixPath;

/** What sheet metal features need: the sheet's rules, the corner relief, and the flanges earlier features made (corners with them get reliefs too). */
export interface SheetInput {
  readonly thickness: number;
  readonly bendRadius: number;
  readonly relief?: { readonly shape: CornerRelief; readonly size: number };
  readonly flanges?: readonly FlangeMarker[];
}

/** Where one copy of a pattern goes: turned about an axis (radians), then shifted. */
export interface Placement {
  readonly translation: Vec3;
  readonly rotation?: { readonly origin: Vec3; readonly direction: Vec3; readonly angle: number };
}

/** The tool solid an earlier extrude/revolve made, to repeat it in patterns and mirrors. */
export interface ToolInput {
  readonly feature: string;
  readonly toolKey: string;
  readonly operation: BodyOperation;
}

interface RequestBase {
  readonly feature: string;
  /** Content hash of everything the result depends on; equal keys give cached results. */
  readonly key: string;
  readonly bodies: readonly BodyState[];
}

export type ModelingRequest = RequestBase &
  (
    | {
        readonly type: 'extrude';
        readonly frame: PlaneFrame;
        readonly profiles: readonly Profile[];
        readonly distance: number;
        readonly direction: 'normal' | 'reverse' | 'symmetric';
        readonly operation: BodyOperation;
      }
    | {
        readonly type: 'revolve';
        readonly frame: PlaneFrame;
        readonly profiles: readonly Profile[];
        readonly axis: AxisInput;
        /** Radians. */
        readonly angle: number;
        readonly operation: BodyOperation;
      }
    | { readonly type: 'fillet' | 'chamfer'; readonly edges: readonly TopologyRef[]; readonly size: number; readonly endSize?: number }
    | ({
        readonly type: 'edge-flange';
        readonly edges: readonly TopologyRef[];
        readonly length: number;
        /** Radians. */
        readonly angle: number;
      } & SheetInput)
    | ({ readonly type: 'hem'; readonly edges: readonly TopologyRef[]; readonly style: HemStyle; readonly gap: number; readonly length: number } & SheetInput)
    | ({
        readonly type: 'miter-flange';
        readonly edges: readonly TopologyRef[];
        /** The profile: straight lines in a plane square to one of the edges, and that plane. */
        readonly profile: readonly PathPiece[];
        readonly frame: PlaneFrame;
      } & SheetInput)
    | { readonly type: 'draft'; readonly faces: readonly TopologyRef[]; readonly plane: PlaneFrame; readonly angle: number }
    | {
        readonly type: 'rib';
        readonly frame: PlaneFrame;
        readonly path: readonly PathPiece[];
        readonly thickness: number;
        /** `next`: up to the next face of the bodies in its direction. */
        readonly depth: number | 'next';
        readonly direction: 'normal' | 'reverse' | 'symmetric';
      }
    | { readonly type: 'shell'; readonly faces: readonly TopologyRef[]; readonly thickness: number }
    | {
        /** Profiles wrapped or projected onto a face, raised out of it or cut into it (wrap.ts). */
        readonly type: 'wrap';
        readonly frame: PlaneFrame;
        readonly profiles: readonly Profile[];
        readonly face: TopologyRef;
        readonly method: 'wrap' | 'project';
        readonly depth: number;
        readonly operation: 'emboss' | 'engrave';
      }
    | {
        readonly type: 'linear-pattern';
        readonly tools: readonly ToolInput[];
        readonly direction: AxisInput;
        readonly count: number;
        readonly spacing: number;
      }
    | {
        readonly type: 'circular-pattern';
        readonly tools: readonly ToolInput[];
        readonly axis: AxisInput;
        readonly count: number;
        /** Radians, spread over all copies (2π for a full circle). */
        readonly angle: number;
      }
    | { readonly type: 'mirror'; readonly tools: readonly ToolInput[]; readonly plane: PlaneFrame }
    | {
        /** Parts (standard, gears, for printing) at points of a plane (parts.ts). */
        readonly type: 'part';
        readonly frame: PlaneFrame;
        readonly points: readonly { readonly id: string; readonly at: Vec2 }[];
        /** Radians, about the plane's normal. */
        readonly angle: number;
        readonly flip: boolean;
        readonly solid: PartSolid;
        readonly operation: BodyOperation;
      }
    | {
        readonly type: 'hole';
        readonly frame: PlaneFrame;
        readonly points: readonly { readonly id: string; readonly at: Vec2 }[];
        readonly spec: HoleSpec;
      }
    | {
        readonly type: 'thread';
        readonly face: TopologyRef;
        readonly size: string;
        readonly diameter: number;
        readonly pitch: number;
        /** Absent: the whole face. */
        readonly length?: number;
        readonly modelled: boolean;
        readonly flip: boolean;
      }
    | { readonly type: 'path-pattern'; readonly tools: readonly ToolInput[]; readonly placements: readonly Placement[] }
    | {
        readonly type: 'loft';
        readonly sections: readonly { readonly frame: PlaneFrame; readonly profile: Profile }[];
        readonly ruled: boolean;
        readonly operation: BodyOperation;
      }
    | {
        readonly type: 'sweep';
        readonly frame: PlaneFrame;
        readonly profiles: readonly Profile[];
        readonly path: readonly (PathPiece | HelixPiece)[];
        readonly closed: boolean;
        readonly operation: BodyOperation;
      }
    /** Solids read by the Interchange Engine (stored without names) become new bodies, named by this feature. */
    | { readonly type: 'insert'; readonly sources: readonly string[] }
    | {
        readonly type: 'combine';
        readonly target: string;
        readonly tools: readonly string[];
        readonly operation: 'join' | 'cut' | 'intersect';
        readonly keepTools: boolean;
      }
    | { readonly type: 'split'; readonly body: string; readonly plane: PlaneFrame }
    | {
        readonly type: 'move';
        readonly bodyIds: readonly string[];
        readonly translation: Vec3;
        /** Radians about the axis, applied before the translation. */
        readonly rotation?: { readonly axis: AxisInput; readonly angle: number };
        readonly copy: boolean;
      }
    | { readonly type: 'scale'; readonly bodyIds: readonly string[]; readonly factor: number }
  );

export interface ModelingOutcome {
  /** All bodies after the feature; unchanged bodies keep their keys. */
  readonly bodies: readonly BodyState[];
  /** Cache key of the tool solid of an extrude/revolve. */
  readonly toolKey?: string;
  /** Why the feature failed; the bodies are then unchanged. */
  readonly error?: string;
  /** Where a thread feature put its thread. */
  readonly thread?: ThreadMarker;
  /** Where a sheet metal feature (edge flange, hem, miter flange) put its flanges. */
  readonly flanges?: readonly FlangeMarker[];
}

/**
 * Builds solids with OpenCascade (docs/Architecture/Components.md#engines). Runs in the geometry
 * worker; shapes stay there (Shape Access) and are referred to by key.
 */
/** A projected edge in plane coordinates: lines and circles (or arcs, counter-clockwise) where they stay such; others as short lines. */
export type ProjectedCurve =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number }
  | { readonly kind: 'arc'; readonly center: Vec2; readonly start: Vec2; readonly end: Vec2 };

export interface ModelingEngine {
  apply(request: ModelingRequest): Promise<ModelingOutcome>;
  /** Edges (or the outlines of faces) projected straight onto a plane, in its (u, v) coordinates. */
  project(bodies: readonly BodyState[], refs: readonly TopologyRef[], frame: PlaneFrame): Promise<Result<ProjectedCurve[]>>;
  /** Where a vertex is (or the centre of an edge or face), for construction planes through points. */
  pointOf(bodies: readonly BodyState[], ref: TopologyRef): Promise<Result<Vec3>>;
  /** The plane of a planar face, for sketches and construction planes on faces. */
  planeOf(bodies: readonly BodyState[], face: TopologyRef): Promise<Result<PlaneFrame>>;
  tessellate(bodies: readonly BodyState[]): Promise<BodyMesh[]>;
  /**
   * The material added from `before` to `after` (each body of `after` without all of `before`) and
   * removed (the other way round), as meshes whose body ids are `added:<id>` and `removed:<id>`.
   */
  compare(before: readonly BodyState[], after: readonly BodyState[]): Promise<Result<BodyDifference>>;
  /**
   * A joint frame in body coordinates: on a flat face its centre and outward normal; on a cylinder,
   * cone or circular edge a point and direction of its axis; on a straight edge its middle and
   * direction. Axes without an inside point along their largest positive world axis.
   */
  frameOf(bodies: readonly BodyState[], ref: TopologyRef): Promise<Result<PlaneFrame>>;
  /**
   * A drawing view of the bodies: their edges seen from a direction with hidden lines removed
   * (OCCT HLR), a section's cut, and the named points, circles and lines to dimension.
   */
  drawView(bodies: readonly BodyState[], request: ViewRequest): Promise<Result<ViewGeometry>>;
  /** The bodies' solids and names, and the threads on them (CAD-166), for publishing as a component result. */
  snapshot(bodies: readonly BodyState[], threads?: readonly ThreadMarker[]): Promise<Uint8Array>;
  /**
   * How many times the kernel was started again after a failure (CAD-133): the shapes of earlier
   * generations are gone, so what held them (open documents) reads them again.
   */
  kernelGeneration(): Promise<number>;
  /**
   * Copies of bodies where an assembly puts them (ids as given), as a snapshot: an assembly's result.
   * The copies are not stored, so they never push other shapes out of the store (CAD-121).
   */
  snapshotPlaced(parts: readonly { readonly id: string; readonly body: BodyState; readonly transform: Matrix4 }[]): Promise<Uint8Array>;
  /** Loads a snapshot into the shape store (as `<prefix>:<body id>`, once) and returns its bodies. */
  restore(snapshot: Uint8Array, prefix: string): Promise<BodyState[]>;
  /** Holds bodies in the shape store while an open document uses them, or lets them go (counted). */
  keep(bodies: readonly BodyState[], kept: boolean): Promise<void>;
}
