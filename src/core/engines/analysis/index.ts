import { guarded, type ShapeAccess } from '@core/access/shape';
import type {
  BodyMesh,
  BodyProperties,
  BodyState,
  Check,
  Interference,
  ManufacturingProfile,
  Matrix4,
  Material,
  Measurement,
  Profile,
  RefShape,
  Result,
  SimulationResult,
  SimulationSetup,
  Sketch,
  TopologyRef,
} from '@core/contracts';
import { OcctAnalysisEngine } from './occt-analysis-engine';

/** A body with the name messages call it by. */
export interface NamedBody extends BodyState {
  readonly name: string;
}

/** A solved sketch with its closed profiles. */
export interface SolvedSketch {
  readonly sketch: Sketch;
  readonly profiles: readonly Profile[];
}

/** An assembly instance's bodies where the assembly puts them. */
export interface PlacedPart {
  readonly instance: string;
  readonly bodies: readonly BodyState[];
  readonly transform: Matrix4;
}

/** What a manufacturability check looks at. */
export interface ValidationSubject {
  readonly bodies: readonly NamedBody[];
  readonly sketches: readonly SolvedSketch[];
}

/**
 * Measures and checks designs (docs/Architecture/Components.md#engines). Runs where the shapes live
 * (the geometry worker).
 */
export interface AnalysisEngine {
  /** Area, length, radius, distance and angle of picked faces and edges. */
  measure(bodies: readonly BodyState[], refs: readonly TopologyRef[]): Promise<Result<Measurement>>;
  /** Like `measure`, between faces, edges and vertices of placed parts (each reference names its part's instance). */
  measurePlaced(parts: readonly PlacedPart[], refs: readonly (TopologyRef & { readonly instance: string })[]): Promise<Result<Measurement>>;
  /** The shape of each face or edge (undefined for vertices and those not found): what repairs match lost references by (CAD-157). */
  shapesOf(bodies: readonly BodyState[], refs: readonly TopologyRef[]): Promise<(RefShape | undefined)[]>;
  /** Volume, area, mass (density in g/cm³; `densities` by body where a body has its own), centre of mass and bounding box of each body. */
  properties(bodies: readonly BodyState[], density: number, densities?: Readonly<Record<string, number>>): Promise<BodyProperties[]>;
  /** The manufacturability rules of the profile's process, applied to the bodies and sketches. */
  validate(subject: ValidationSubject, profile: ManufacturingProfile): Promise<Check[]>;
  /**
   * Pairs of parts whose solids overlap, with the overlapping volume; only the given pairs of
   * instances when `pairs` is set. Touching is fine: an overlap below a ten-thousandth of the smaller
   * part's volume (a pin in a hole of its size) is the kernel's rounding, not interference (CAD-112).
   */
  interference(parts: readonly PlacedPart[], pairs?: readonly (readonly [string, string])[]): Promise<Interference[]>;
  /** A linear static strength check of the bodies (their display meshes) under the setup's loads (CAD-93), each of its own material in `byBody`, else of `material` (CAD-158). */
  simulate(meshes: readonly BodyMesh[], setup: SimulationSetup, material: Material, byBody?: Readonly<Record<string, Material>>): Promise<Result<SimulationResult>>;
}

export function createAnalysisEngine(shapes: ShapeAccess): AnalysisEngine {
  return guarded(new OcctAnalysisEngine(shapes), shapes);
}
