import type { BodyMesh, BodyOperation, BodyState, PlaneFrame, Profile, Result, TopologyRef, Vec3 } from '@core/contracts';

export type { BodyState };

/** An axis given in world coordinates, or by a straight edge of a body. */
export type AxisInput = { readonly origin: Vec3; readonly direction: Vec3 } | { readonly edge: TopologyRef };

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
    | { readonly type: 'fillet' | 'chamfer'; readonly edges: readonly TopologyRef[]; readonly size: number }
    | { readonly type: 'shell'; readonly faces: readonly TopologyRef[]; readonly thickness: number }
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
  );

export interface ModelingOutcome {
  /** All bodies after the feature; unchanged bodies keep their keys. */
  readonly bodies: readonly BodyState[];
  /** Cache key of the tool solid of an extrude/revolve. */
  readonly toolKey?: string;
  /** Why the feature failed; the bodies are then unchanged. */
  readonly error?: string;
}

/**
 * Builds solids with OpenCascade (docs/Architecture/Components.md#engines). Runs in the geometry
 * worker; shapes stay there (Shape Access) and are referred to by key.
 */
export interface ModelingEngine {
  apply(request: ModelingRequest): Promise<ModelingOutcome>;
  /** The plane of a planar face, for sketches and construction planes on faces. */
  planeOf(bodies: readonly BodyState[], face: TopologyRef): Promise<Result<PlaneFrame>>;
  tessellate(bodies: readonly BodyState[]): Promise<BodyMesh[]>;
}
