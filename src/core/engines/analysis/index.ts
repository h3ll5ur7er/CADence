import type { ShapeAccess } from '@core/access/shape';
import type {
  BodyProperties,
  BodyState,
  Check,
  Interference,
  ManufacturingProfile,
  Matrix4,
  Measurement,
  Profile,
  Result,
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
  /** Volume, area, mass (density in g/cm³), centre of mass and bounding box of each body. */
  properties(bodies: readonly BodyState[], density: number): Promise<BodyProperties[]>;
  /** The manufacturability rules of the profile's process, applied to the bodies and sketches. */
  validate(subject: ValidationSubject, profile: ManufacturingProfile): Promise<Check[]>;
  /** Pairs of parts whose solids overlap (touching is fine), with the overlapping volume. */
  interference(parts: readonly PlacedPart[]): Promise<Interference[]>;
}

export function createAnalysisEngine(shapes: ShapeAccess): AnalysisEngine {
  return new OcctAnalysisEngine(shapes);
}
