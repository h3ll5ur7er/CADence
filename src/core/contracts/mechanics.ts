import type { Material } from './analysis';
import type { Vec3 } from './feature';
import type { SpringEnds } from './parts';

/**
 * What parts do, worked out from their sizes: where meshing gears go and how they turn (spur, shifted,
 * ring, planetary, bevel and worm gears), what springs do, and where helices run. Kept apart from the
 * part and feature types so the command reference stays short.
 */

/** A helix in space, as built: about `axis` through `origin`, starting at `origin + radius · x` (mm, radians). */
export interface HelixPath {
  readonly feature: string;
  readonly origin: Vec3;
  readonly axis: Vec3;
  readonly x: Vec3;
  readonly radius: number;
  readonly pitch: number;
  readonly height: number;
  readonly taper: number;
  readonly leftHanded: boolean;
}

/** A point of a helix, `t` of the way along it (0 to 1). */
export function helixPoint(helix: HelixPath, t: number): Vec3 {
  const { origin, axis: n, x, radius, pitch, height, taper, leftHanded } = helix;
  const y: Vec3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  const rise = height * t;
  const angle = ((leftHanded ? -2 : 2) * Math.PI * rise) / pitch;
  const r = radius + rise * Math.tan(taper);
  return [0, 1, 2].map((k) => (origin[k] as number) + (n[k] as number) * rise + r * (Math.cos(angle) * (x[k] as number) + Math.sin(angle) * (y[k] as number))) as unknown as Vec3;
}

const involute = (a: number) => Math.tan(a) - a;

/**
 * The centre distance of two meshing gears of the same module (mm). With profile shifts (CAD-159) they
 * mesh without backlash at the working pressure angle αw: inv αw = inv α + 2 tan α (x₁ + x₂) / (z₁ + z₂),
 * a = m (z₁ + z₂) / 2 · cos α / cos αw.
 */
export function centreDistance(module: number, teethA: number, teethB: number, shiftA = 0, shiftB = 0, pressureAngle = Math.PI / 9): number {
  const plain = (module * (teethA + teethB)) / 2;
  if (!shiftA && !shiftB) return plain;
  const target = involute(pressureAngle) + (2 * Math.tan(pressureAngle) * (shiftA + shiftB)) / (teethA + teethB);
  // Newton on inv(αw) = target: its slope is tan²αw, and it rises steadily on (0, π/2).
  let working = pressureAngle;
  for (let i = 0; i < 40; i++) working = Math.min(1.5, Math.max(1e-3, working - (involute(working) - target) / Math.tan(working) ** 2));
  return (plain * Math.cos(pressureAngle)) / Math.cos(working);
}

/**
 * The least profile shift that keeps a gear cut by a rack free of undercut: x = 1 − z sin²α / 2 (17
 * teeth at 20° need none). A gear of fewer teeth needs at least this much to keep its whole involute.
 */
export const minimumProfileShift = (teeth: number, pressureAngle: number): number => 1 - (teeth * Math.sin(pressureAngle) ** 2) / 2;

/**
 * A straight bevel gear and its mate (CAD-160): the half angles of their pitch cones (radians), how far
 * each cone's apex lies from its gear's large end along its axis (mm), and where the mate goes for a
 * gear on the XY plane (large end at z = 0, its axis along z towards the apex): the mate's large end
 * centred at `mate` = [x, z], its axis towards the apex at the shaft angle to this one's, turned by
 * `turn` degrees (from its x axis along the world's y) so a tooth space faces this gear's tooth. The
 * mate turns −teeth / mateTeeth of the gear's turn (`ratio`).
 */
export function bevelMesh(module: number, teeth: number, mateTeeth: number, shaftAngle: number) {
  const pitchAngle = Math.atan2(Math.sin(shaftAngle), mateTeeth / teeth + Math.cos(shaftAngle));
  const matePitchAngle = shaftAngle - pitchAngle;
  const [radius, mateRadius] = [(module * teeth) / 2, (module * mateTeeth) / 2];
  const [apex, mateApex] = [radius / Math.tan(pitchAngle), mateRadius / Math.tan(matePitchAngle)];
  const mate: readonly [number, number] = [mateApex * Math.sin(shaftAngle), apex - mateApex * Math.cos(shaftAngle)];
  const tooth = 360 / mateTeeth;
  const turn = (((90 - tooth / 2) % tooth) + tooth) % tooth;
  return { pitchAngle, matePitchAngle, apex, mateApex, coneDistance: radius / Math.sin(pitchAngle), mate, turn, ratio: -teeth / mateTeeth };
}

/**
 * A worm and its wheel (CAD-160): the worm's pitch diameter (starts × module / tan(lead angle)), the
 * wheel's (module × teeth), the distance between their axes (mm), and how far the wheel turns per turn
 * of the worm (starts / teeth).
 */
export function wormMesh(module: number, starts: number, leadAngle: number, teeth: number) {
  const worm = (starts * module) / Math.tan(leadAngle);
  const wheel = module * teeth;
  return { worm, wheel, distance: (worm + wheel) / 2, ratio: starts / teeth };
}

/** A spring's sizes in mm, as built (CAD-161): `mean` is the coil's mean diameter (outside less the wire). */
export type SpringSize =
  | { readonly kind: 'compression'; readonly wire: number; readonly mean: number; readonly pitch: number; readonly turns: number; readonly ends: SpringEnds }
  | { readonly kind: 'extension'; readonly wire: number; readonly mean: number; readonly turns: number }
  | { readonly kind: 'torsion'; readonly wire: number; readonly mean: number; readonly pitch: number; readonly turns: number; readonly legs: number };

/** What a spring does, for the component's properties. */
export interface SpringProperties {
  readonly kind: SpringSize['kind'];
  /** N/mm; a torsion spring's in N·mm per degree. */
  readonly rate: number;
  readonly activeTurns: number;
  /** Compression: free length; extension: length inside the hooks; torsion: length of the coils (mm). */
  readonly freeLength: number;
  /** A compression spring's length with its coils touching (mm). */
  readonly solidLength?: number;
}

/**
 * A spring's rate from its wire, coils and material (CAD-161): k = G d⁴ / (8 D³ nₐ) for compression and
 * extension springs, with the shear modulus G = E / (2 (1 + ν)); k = E d⁴ / (64 D nₐ) per radian for
 * torsion springs, their legs adding (l₁ + l₂) / (3π D) active turns. Closed and ground compression
 * springs have one inactive turn at each end; free and solid lengths follow the usual end types.
 */
export function springProperties(size: SpringSize, material: Pick<Material, 'youngsModulus' | 'poisson'>): SpringProperties {
  const e = material.youngsModulus ?? 200_000;
  const g = e / (2 * (1 + (material.poisson ?? 0.3)));
  const { wire: d, mean: D, turns } = size;
  switch (size.kind) {
    case 'compression': {
      const active = size.ends === 'open' ? turns : turns - 2;
      const freeLength = size.ends === 'open' ? size.pitch * turns + d : size.ends === 'closed' ? size.pitch * active + 3 * d : size.pitch * active + 2 * d;
      const solidLength = size.ends === 'ground' ? d * turns : d * (turns + 1);
      return { kind: 'compression', rate: (g * d ** 4) / (8 * D ** 3 * active), activeTurns: active, freeLength, solidLength };
    }
    case 'extension':
      // Inside the hooks: the coils' (turns + 1) wires, and each loop's inside diameter beyond them.
      return { kind: 'extension', rate: (g * d ** 4) / (8 * D ** 3 * turns), activeTurns: turns, freeLength: d * (turns - 1) + 2 * D };
    case 'torsion': {
      const active = turns + (2 * size.legs) / (3 * Math.PI * D);
      return { kind: 'torsion', rate: ((e * d ** 4) / (64 * D * active)) * (Math.PI / 180), activeTurns: active, freeLength: size.pitch * turns + d };
    }
  }
}

/** Teeth a ring gear needs more than a planet in it: fewer, and the planet's tips foul the ring's (20° teeth). */
export const ringGearMinimumDifference = 10;

/** A planet inside a ring gear: where its centre goes (mm from the ring's centre) and whether it fits. */
export function ringGearMesh(module: number, ring: number, planet: number): { readonly distance: number; readonly fits: boolean } {
  return { distance: (module * (ring - planet)) / 2, fits: ring - planet >= ringGearMinimumDifference };
}

/**
 * A planetary gear set with the ring fixed and the sun driving: the carrier turns `carrier` turns per
 * turn of the sun, and each planet `planet` turns about its own pin on the carrier (the other way).
 * The planets have (ring − sun) / 2 teeth.
 */
export function planetaryRatios(sun: number, ring: number): { readonly carrier: number; readonly planet: number } {
  const carrier = sun / (sun + ring);
  const planet = (ring - sun) / 2;
  return { carrier, planet: planet > 0 ? (-sun / planet) * (1 - carrier) : 0 };
}
