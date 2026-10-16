/**
 * Parts a component can add by size: standard parts from their standards (ISO 4762 screws, ISO 4032
 * nuts, ISO 7089 washers), heat-set inserts, magnets and ball bearings; gears and racks; and parts
 * made for printing (snap fits, pegs, dovetails, living hinges). Lengths are expressions (mm).
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
  /** A spur gear (helical with a helix angle), involute teeth, centred on the point with a tooth along the plane's u axis. */
  | { readonly kind: 'gear'; readonly module: string; readonly teeth: string; readonly width: string; readonly bore: string; readonly pressureAngle: string; readonly helixAngle: string }
  /**
   * A ring gear: internal involute teeth in a ring of `outside` diameter, centred on the point, a tooth
   * space along the plane's u axis. Planets mesh inside it ({@link ringGearMesh}).
   */
  | { readonly kind: 'ring-gear'; readonly module: string; readonly teeth: string; readonly width: string; readonly outside: string; readonly pressureAngle: string; readonly helixAngle: string }
  /** A gear rack along the plane's u axis, teeth towards its v axis. */
  | { readonly kind: 'rack'; readonly module: string; readonly teeth: string; readonly width: string; readonly height: string; readonly pressureAngle: string }
  /** A cantilever snap-fit hook standing on the plane, its hook towards the plane's v axis. */
  | { readonly kind: 'snap-fit'; readonly length: string; readonly width: string; readonly thickness: string; readonly hook: string }
  /** A press-fit peg, its diameter less the fit allowance, chamfered at the top. */
  | { readonly kind: 'peg'; readonly diameter: string; readonly height: string; readonly fit: FitClass }
  /** A dovetail rail along the plane's v axis (cut into a body: a slot, widened by the fit allowance). */
  | { readonly kind: 'dovetail'; readonly width: string; readonly depth: string; readonly length: string; readonly angle: string; readonly fit: FitClass }
  /** A living hinge for printing: a groove across a plate, leaving a thin flexible web; its length along the plane's u axis. */
  | { readonly kind: 'living-hinge'; readonly length: string; readonly width: string; readonly depth: string };

export type PartKind = PartSpec['kind'];

export const partLabels: Readonly<Record<PartKind, string>> = {
  screw: 'Screw (ISO 4762)',
  nut: 'Nut (ISO 4032)',
  washer: 'Washer (ISO 7089)',
  insert: 'Heat-set insert',
  magnet: 'Magnet',
  bearing: 'Ball bearing',
  gear: 'Gear',
  'ring-gear': 'Ring gear (internal)',
  rack: 'Gear rack',
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
    case 'rack':
      return { kind, module: '1 mm', teeth: '15', width: '6 mm', height: '8 mm', pressureAngle: '20 deg' };
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

/** The centre distance of two meshing gears of the same module (mm). */
export const centreDistance = (module: number, teethA: number, teethB: number): number => (module * (teethA + teethB)) / 2;

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
