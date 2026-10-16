import type { TopologyRef, Vec3 } from './feature';
import type { Vec2 } from './sketch';

/** What a component is made of; density in g/cm³. */
export interface Material {
  readonly name: string;
  readonly density: number;
}

/** Common materials for home 3D printing and laser cutting. The first is the default. */
export const materials: readonly Material[] = [
  { name: 'PLA', density: 1.24 },
  { name: 'PETG', density: 1.27 },
  { name: 'ABS', density: 1.04 },
  { name: 'ASA', density: 1.07 },
  { name: 'TPU', density: 1.21 },
  { name: 'Nylon', density: 1.14 },
  { name: 'Resin', density: 1.15 },
  { name: 'Plywood', density: 0.68 },
  { name: 'MDF', density: 0.75 },
  { name: 'Acrylic', density: 1.19 },
  { name: 'Aluminium', density: 2.7 },
  { name: 'Steel', density: 7.85 },
];

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
