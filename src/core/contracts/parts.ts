import type { Material } from './analysis';

/**
 * Parts a component can add by size: standard parts from their standards (ISO 4762 screws, ISO 4032
 * nuts, ISO 7089 washers), heat-set inserts, magnets and ball bearings; gears (spur, helical, ring,
 * bevel, worm and worm wheel) and racks; springs; and parts made for printing (snap fits, pegs,
 * dovetails, living hinges). Lengths are expressions (mm).
 */

/** How tightly printed parts fit: added to holes and slots, taken off pegs (on the diameter, mm). */
export type FitClass = 'press' | 'snug' | 'loose';
export const fitAllowance: Readonly<Record<FitClass, number>> = { press: 0, snug: 0.15, loose: 0.3 };
export const fitClasses: readonly FitClass[] = ['press', 'snug', 'loose'];

export type MetricSize = 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10';
export const metricSizes: readonly MetricSize[] = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10'];

/** Dimensions of the metric sizes (mm): nominal diameter; socket head (ISO 4762) diameter, height and socket across flats; nut (ISO 4032) across flats and height; washer (ISO 7089) outside diameter and thickness; holes for it; a typical heat-set insert. */
export interface MetricDimensions {
  readonly d: number;
  readonly head: { readonly diameter: number; readonly height: number; readonly socket: number };
  readonly nut: { readonly acrossFlats: number; readonly height: number };
  readonly washer: { readonly inner: number; readonly outer: number; readonly thickness: number };
  /** ISO 273 medium clearance hole, and the drill for tapping the thread. */
  readonly clearance: number;
  readonly tapDrill: number;
  /** A heat-set insert: its outside diameter and length, and the hole it is pressed into. */
  readonly insert: { readonly diameter: number; readonly length: number; readonly hole: number };
}

export const metric: Readonly<Record<MetricSize, MetricDimensions>> = {
  M2: { d: 2, head: { diameter: 3.8, height: 2, socket: 1.5 }, nut: { acrossFlats: 4, height: 1.6 }, washer: { inner: 2.2, outer: 5, thickness: 0.3 }, clearance: 2.4, tapDrill: 1.6, insert: { diameter: 3.6, length: 3, hole: 3.2 } },
  'M2.5': { d: 2.5, head: { diameter: 4.5, height: 2.5, socket: 2 }, nut: { acrossFlats: 5, height: 2 }, washer: { inner: 2.7, outer: 6, thickness: 0.5 }, clearance: 2.9, tapDrill: 2.05, insert: { diameter: 4, length: 4, hole: 3.6 } },
  M3: { d: 3, head: { diameter: 5.5, height: 3, socket: 2.5 }, nut: { acrossFlats: 5.5, height: 2.4 }, washer: { inner: 3.2, outer: 7, thickness: 0.5 }, clearance: 3.4, tapDrill: 2.5, insert: { diameter: 5, length: 5.7, hole: 4.2 } },
  M4: { d: 4, head: { diameter: 7, height: 4, socket: 3 }, nut: { acrossFlats: 7, height: 3.2 }, washer: { inner: 4.3, outer: 9, thickness: 0.8 }, clearance: 4.5, tapDrill: 3.3, insert: { diameter: 6.3, length: 8.1, hole: 5.6 } },
  M5: { d: 5, head: { diameter: 8.5, height: 5, socket: 4 }, nut: { acrossFlats: 8, height: 4.7 }, washer: { inner: 5.3, outer: 10, thickness: 1 }, clearance: 5.5, tapDrill: 4.2, insert: { diameter: 7, length: 9.5, hole: 6.4 } },
  M6: { d: 6, head: { diameter: 10, height: 6, socket: 5 }, nut: { acrossFlats: 10, height: 5.2 }, washer: { inner: 6.4, outer: 12, thickness: 1.6 }, clearance: 6.6, tapDrill: 5, insert: { diameter: 8, length: 12.7, hole: 7.6 } },
  M8: { d: 8, head: { diameter: 13, height: 8, socket: 6 }, nut: { acrossFlats: 13, height: 6.8 }, washer: { inner: 8.4, outer: 16, thickness: 1.6 }, clearance: 9, tapDrill: 6.8, insert: { diameter: 10, length: 12.7, hole: 9.6 } },
  M10: { d: 10, head: { diameter: 16, height: 10, socket: 8 }, nut: { acrossFlats: 16, height: 8.4 }, washer: { inner: 10.5, outer: 20, thickness: 2 }, clearance: 11, tapDrill: 8.5, insert: { diameter: 12, length: 12.7, hole: 11.6 } },
};

export type BearingSize = '623' | '625' | '608' | '688' | '6000' | '6001' | '6200' | '6201';
/** Deep groove ball bearings: bore, outside diameter and width (mm). */
export const bearings: Readonly<Record<BearingSize, { readonly bore: number; readonly outer: number; readonly width: number }>> = {
  '623': { bore: 3, outer: 10, width: 4 },
  '625': { bore: 5, outer: 16, width: 5 },
  '608': { bore: 8, outer: 22, width: 7 },
  '688': { bore: 8, outer: 16, width: 5 },
  '6000': { bore: 10, outer: 26, width: 8 },
  '6001': { bore: 12, outer: 28, width: 8 },
  '6200': { bore: 10, outer: 30, width: 9 },
  '6201': { bore: 12, outer: 32, width: 10 },
};

/** What a part feature makes. */
export type PartSpec =
  /** ISO 4762 socket head cap screw: the head stands on the plane, the shank goes below it. */
  | { readonly kind: 'screw'; readonly size: MetricSize; readonly length: string }
  /** ISO 4032 hex nut. */
  | { readonly kind: 'nut'; readonly size: MetricSize }
  /** ISO 7089 flat washer. */
  | { readonly kind: 'washer'; readonly size: MetricSize }
  /** A heat-set insert, its top in the plane, going below it. */
  | { readonly kind: 'insert'; readonly size: MetricSize }
  /** A disc magnet. */
  | { readonly kind: 'magnet'; readonly diameter: string; readonly height: string }
  /** A deep groove ball bearing. */
  | { readonly kind: 'bearing'; readonly size: BearingSize }
  /**
   * A spur gear (helical with a helix angle), involute teeth, centred on the point with a tooth along the
   * plane's u axis. `chamfer` bevels the teeth at both ends by that much at the tip (45°), so a helical
   * tooth ends in no knife edge (CAD-140); none when left out. `shift` is the profile shift coefficient
   * x (CAD-159): teeth x·module further out and thicker at the root, so few teeth have no undercut
   * ({@link minimumProfileShift}) and centre distances can be adjusted ({@link centreDistance}); 0 when
   * left out.
   */
  | { readonly kind: 'gear'; readonly module: string; readonly teeth: string; readonly width: string; readonly bore: string; readonly pressureAngle: string; readonly helixAngle: string; readonly chamfer?: string; readonly shift?: string }
  /**
   * A straight bevel gear (CAD-160) for a mate of `mateTeeth` at `shaftAngle` (90° by default): its large
   * end on the plane, the teeth narrowing along the normal towards the apex of its pitch cone, a tooth
   * along the plane's u axis. `faceWidth` is the teeth's length along the cone. {@link bevelMesh} says
   * where the mate goes.
   */
  | { readonly kind: 'bevel-gear'; readonly module: string; readonly teeth: string; readonly mateTeeth: string; readonly shaftAngle: string; readonly faceWidth: string; readonly bore: string; readonly pressureAngle: string }
  /**
   * A worm (CAD-160): `starts` right-hand threads of axial module `module` at `leadAngle` (its pitch
   * diameter follows: starts × module / tan(lead angle)), centred on the point along the plane's normal,
   * `length` long, a thread crossing the plane on the u axis. {@link wormMesh} says where its wheel goes.
   */
  | { readonly kind: 'worm'; readonly module: string; readonly starts: string; readonly leadAngle: string; readonly length: string; readonly bore: string; readonly pressureAngle: string }
  /**
   * A worm wheel (CAD-160) for a worm of `starts` and `leadAngle`: right-hand helical teeth at the lead
   * angle (a crossed helical gear, touching the worm at points: not throated), standing on the plane
   * like a gear, a tooth space facing the plane's −u axis halfway up, where the worm goes.
   */
  | { readonly kind: 'worm-wheel'; readonly module: string; readonly teeth: string; readonly starts: string; readonly leadAngle: string; readonly width: string; readonly bore: string; readonly pressureAngle: string }
  /**
   * A ring gear: internal involute teeth in a ring of `outside` diameter, centred on the point, a tooth
   * space along the plane's u axis. Planets mesh inside it ({@link ringGearMesh}).
   */
  | { readonly kind: 'ring-gear'; readonly module: string; readonly teeth: string; readonly width: string; readonly outside: string; readonly pressureAngle: string; readonly helixAngle: string }
  /** A gear rack along the plane's u axis, teeth towards its v axis. */
  | { readonly kind: 'rack'; readonly module: string; readonly teeth: string; readonly width: string; readonly height: string; readonly pressureAngle: string }
  /**
   * A helical compression spring (CAD-161) of round wire standing on the plane, its axis along the
   * normal: `turns` in all, `pitch` apart. Ends: open (plain), closed (the end turns touching) or ground
   * (closed and ground flat). {@link springProperties} gives its rate and lengths.
   */
  | { readonly kind: 'compression-spring'; readonly wire: string; readonly outside: string; readonly pitch: string; readonly turns: string; readonly ends: SpringEnds }
  /** A helical extension spring: `turns` of coils a wire apart and a loop of the coil's diameter bent up from the last coil at each end (side loops). */
  | { readonly kind: 'extension-spring'; readonly wire: string; readonly outside: string; readonly turns: string }
  /** A helical torsion spring: `turns` `pitch` apart and a straight leg `legs` long at each end, along the coil. */
  | { readonly kind: 'torsion-spring'; readonly wire: string; readonly outside: string; readonly pitch: string; readonly turns: string; readonly legs: string }
  /** A cantilever snap-fit hook standing on the plane, its hook towards the plane's v axis. */
  | { readonly kind: 'snap-fit'; readonly length: string; readonly width: string; readonly thickness: string; readonly hook: string }
  /** A press-fit peg, its diameter less the fit allowance, chamfered at the top. */
  | { readonly kind: 'peg'; readonly diameter: string; readonly height: string; readonly fit: FitClass }
  /** A dovetail rail along the plane's v axis (cut into a body: a slot, widened by the fit allowance). */
  | { readonly kind: 'dovetail'; readonly width: string; readonly depth: string; readonly length: string; readonly angle: string; readonly fit: FitClass }
  /** A living hinge for printing: a groove across a plate, leaving a thin flexible web; its length along the plane's u axis. */
  | { readonly kind: 'living-hinge'; readonly length: string; readonly width: string; readonly depth: string };

export type PartKind = PartSpec['kind'];

/** How a compression spring ends: plain, with closed end turns, or closed and ground flat. */
export type SpringEnds = 'open' | 'closed' | 'ground';
export const springEnds: readonly SpringEnds[] = ['open', 'closed', 'ground'];

export const partLabels: Readonly<Record<PartKind, string>> = {
  screw: 'Screw (ISO 4762)',
  nut: 'Nut (ISO 4032)',
  washer: 'Washer (ISO 7089)',
  insert: 'Heat-set insert',
  magnet: 'Magnet',
  bearing: 'Ball bearing',
  gear: 'Gear',
  'ring-gear': 'Ring gear (internal)',
  'bevel-gear': 'Bevel gear',
  worm: 'Worm',
  'worm-wheel': 'Worm wheel',
  rack: 'Gear rack',
  'compression-spring': 'Compression spring',
  'extension-spring': 'Extension spring',
  'torsion-spring': 'Torsion spring',
  'snap-fit': 'Snap-fit hook',
  peg: 'Press-fit peg',
  dovetail: 'Dovetail',
  'living-hinge': 'Living hinge',
};

/** A part of the kind with typical sizes, to start from. */
export function defaultPart(kind: PartKind): PartSpec {
  switch (kind) {
    case 'screw':
      return { kind, size: 'M3', length: '12 mm' };
    case 'nut':
    case 'washer':
    case 'insert':
      return { kind, size: 'M3' };
    case 'magnet':
      return { kind, diameter: '6 mm', height: '3 mm' };
    case 'bearing':
      return { kind, size: '608' };
    case 'gear':
      return { kind, module: '1 mm', teeth: '20', width: '6 mm', bore: '5 mm', pressureAngle: '20 deg', helixAngle: '0 deg' };
    case 'ring-gear':
      return { kind, module: '1 mm', teeth: '60', width: '6 mm', outside: '70 mm', pressureAngle: '20 deg', helixAngle: '0 deg' };
    case 'bevel-gear':
      return { kind, module: '1 mm', teeth: '20', mateTeeth: '20', shaftAngle: '90 deg', faceWidth: '4 mm', bore: '5 mm', pressureAngle: '20 deg' };
    case 'worm':
      return { kind, module: '1 mm', starts: '1', leadAngle: '5 deg', length: '20 mm', bore: '3 mm', pressureAngle: '20 deg' };
    case 'worm-wheel':
      return { kind, module: '1 mm', teeth: '30', starts: '1', leadAngle: '5 deg', width: '6 mm', bore: '5 mm', pressureAngle: '20 deg' };
    case 'rack':
      return { kind, module: '1 mm', teeth: '15', width: '6 mm', height: '8 mm', pressureAngle: '20 deg' };
    case 'compression-spring':
      return { kind, wire: '1 mm', outside: '10 mm', pitch: '3 mm', turns: '8', ends: 'ground' };
    case 'extension-spring':
      return { kind, wire: '1 mm', outside: '8 mm', turns: '12' };
    case 'torsion-spring':
      return { kind, wire: '1 mm', outside: '10 mm', pitch: '1.2 mm', turns: '5', legs: '15 mm' };
    case 'snap-fit':
      return { kind, length: '12 mm', width: '6 mm', thickness: '1.6 mm', hook: '1 mm' };
    case 'peg':
      return { kind, diameter: '5 mm', height: '6 mm', fit: 'snug' };
    case 'dovetail':
      return { kind, width: '8 mm', depth: '4 mm', length: '30 mm', angle: '15 deg', fit: 'snug' };
    case 'living-hinge':
      return { kind, length: '40 mm', width: '6 mm', depth: '1.6 mm' };
  }
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
