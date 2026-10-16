import type { TopologyRef, Vec3 } from './feature';
import type { Vec2 } from './sketch';

/**
 * What a component is made of: density in g/cm³; for strength checks, Young's modulus and yield
 * strength in MPa (N/mm²) and Poisson's ratio. Printed parts are weaker than the solid material and
 * depend on direction: the values are typical solid ones.
 */
export interface Material {
  readonly name: string;
  readonly density: number;
  readonly youngsModulus?: number;
  readonly poisson?: number;
  readonly yieldStrength?: number;
}

/** Common materials for home 3D printing and laser cutting. The first is the default. */
export const materials: readonly Material[] = [
  { name: 'PLA', density: 1.24, youngsModulus: 3500, poisson: 0.36, yieldStrength: 50 },
  { name: 'PETG', density: 1.27, youngsModulus: 2100, poisson: 0.38, yieldStrength: 50 },
  { name: 'ABS', density: 1.04, youngsModulus: 2300, poisson: 0.35, yieldStrength: 40 },
  { name: 'ASA', density: 1.07, youngsModulus: 2000, poisson: 0.35, yieldStrength: 45 },
  { name: 'TPU', density: 1.21, youngsModulus: 26, poisson: 0.45, yieldStrength: 9 },
  { name: 'Nylon', density: 1.14, youngsModulus: 1700, poisson: 0.39, yieldStrength: 45 },
  { name: 'Resin', density: 1.15, youngsModulus: 2500, poisson: 0.38, yieldStrength: 55 },
  { name: 'Plywood', density: 0.68, youngsModulus: 9000, poisson: 0.3, yieldStrength: 40 },
  { name: 'MDF', density: 0.75, youngsModulus: 4000, poisson: 0.25, yieldStrength: 18 },
  { name: 'Acrylic', density: 1.19, youngsModulus: 3200, poisson: 0.37, yieldStrength: 70 },
  { name: 'Aluminium', density: 2.7, youngsModulus: 69000, poisson: 0.33, yieldStrength: 240 },
  { name: 'Steel', density: 7.85, youngsModulus: 200000, poisson: 0.3, yieldStrength: 250 },
];

/** A load on a face: a force (N, spread over the face) along a direction, or a pressure (MPa) pushing on it. */
export type SimulationLoad =
  | { readonly kind: 'force'; readonly face: TopologyRef; readonly force: number; readonly direction: Vec3 }
  | { readonly kind: 'pressure'; readonly face: TopologyRef; readonly pressure: number };

/** A linear static strength check of a component (CAD-93): the faces held fixed and the loads. */
export interface SimulationSetup {
  readonly fixed: readonly TopologyRef[];
  readonly loads: readonly SimulationLoad[];
  /** Element size (mm); absent: chosen from the part's size. */
  readonly size?: number;
}

/** A body's surface with the results of a strength check on it. */
export interface SimulationSurface {
  readonly body: string;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly stress: Float32Array;
  readonly displacement: Float32Array;
}

/** The result of a strength check, in N, mm and MPa. */
export interface SimulationResult {
  /** The largest von Mises stress, and where it is. */
  readonly maxStress: number;
  readonly maxStressAt: Vec3;
  /** The largest deflection. */
  readonly maxDisplacement: number;
  /** Yield strength over the largest stress (absent without a yield strength). */
  readonly safetyFactor?: number;
  readonly elements: number;
  readonly nodes: number;
  /** Per body: its surface as the solution sees it (triangles), with von Mises stress and displacement (x, y, z) at each vertex. */
  readonly bodies: readonly SimulationSurface[];
  /** The finite element nodes: positions, displacements (3 each) and von Mises stress. */
  readonly mesh: { readonly positions: Float32Array; readonly displacement: Float32Array; readonly stress: Float32Array };
}

/** A 3D printer: build volume (mm), nozzle and layer height (mm), steepest overhang without supports (degrees from vertical). */
export interface PrintProfile {
  readonly kind: 'print';
  readonly name: string;
  readonly bed: Vec3;
  readonly nozzle: number;
  readonly layerHeight: number;
  readonly maxOverhang: number;
  /** Added to the diameter of holes (and taken off pegs) so parts fit as designed on this printer (mm). */
  readonly holeCompensation?: number;
}

/** A laser cutter: bed (mm), kerf (width of the cut, mm) and sheet thickness (mm). */
export interface LaserProfile {
  readonly kind: 'laser';
  readonly name: string;
  readonly bed: Vec2;
  readonly kerf: number;
  readonly thickness: number;
}

export type ManufacturingProfile = PrintProfile | LaserProfile;

/** Starting points for the manufacturing profile; the first is the default. */
export const manufacturingProfiles: readonly ManufacturingProfile[] = [
  { kind: 'print', name: 'FDM printer 220 × 220 × 250', bed: [220, 220, 250], nozzle: 0.4, layerHeight: 0.2, maxOverhang: 45 },
  { kind: 'print', name: 'FDM printer 256 × 256 × 256', bed: [256, 256, 256], nozzle: 0.4, layerHeight: 0.2, maxOverhang: 45 },
  { kind: 'laser', name: 'Diode laser 400 × 400, 3 mm plywood', bed: [400, 400], kerf: 0.15, thickness: 3 },
  { kind: 'laser', name: 'CO₂ laser 600 × 400, 3 mm acrylic', bed: [600, 400], kerf: 0.2, thickness: 3 },
];

/** What was measured between the picked faces and edges; only the values that apply are present. */
export interface Measurement {
  /** Total area of the picked faces, mm². */
  readonly area?: number;
  /** Total length of the picked edges, mm. */
  readonly length?: number;
  /** Radius of a single cylindrical or spherical face, or circular edge, mm. */
  readonly radius?: number;
  /** Shortest distance between two picks, mm, with the closest points. */
  readonly distance?: number;
  readonly points?: readonly [Vec3, Vec3];
  /** Angle between two flat faces or straight edges, radians (0 to π/2). */
  readonly angle?: number;
}

/** Mass properties of a body; mass in g from the component's material. */
export interface BodyProperties {
  readonly body: string;
  readonly volume: number;
  readonly area: number;
  readonly mass: number;
  readonly centerOfMass: Vec3;
  readonly box: { readonly min: Vec3; readonly max: Vec3 };
}

export type CheckStatus = 'pass' | 'warning' | 'fail';

/** One manufacturability rule and how the design does on it. */
export interface Check {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly message: string;
  /** Faces the result is about, to highlight them. */
  readonly faces?: readonly TopologyRef[];
}

export interface ValidationReport {
  readonly profile: ManufacturingProfile;
  readonly checks: readonly Check[];
}
