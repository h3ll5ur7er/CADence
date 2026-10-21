import { adopt } from '@core/access/shape';
import type { SpringSize, Vec3 } from '@core/contracts';
import { assembleWire, getOC, makeBSplineApproximation, makeCircle, makeCylinder, makeLine, type Shape3D, Wire } from 'replicad';
import { add3, normalize3, scale3, sub3 } from './geometry';

/**
 * Helices and what is made along them (CAD-161): helix wires for sweeps, round wire coiled into
 * springs, and the threads of worms (CAD-160). Sizes in millimetres, angles in radians.
 */

/** A failure the user can act on. */
export class HelixError extends Error {}

/**
 * A helix about `axis` through `origin`, starting at `origin + radius · x` and rising `pitch` per turn
 * for `height`; `taper` leans it outwards (positive) or inwards as it rises, a conical helix. Right
 * handed (counter-clockwise about the axis as it rises) unless `leftHanded`.
 */
export interface Helix {
  readonly origin: Vec3;
  readonly axis: Vec3;
  readonly x: Vec3;
  readonly radius: number;
  readonly pitch: number;
  readonly height: number;
  readonly taper: number;
  readonly leftHanded: boolean;
}

/** The helix as an exact curve: a straight line on a cylinder, or on a cone when it tapers. */
export function helixWire(helix: Helix): Wire {
  const { origin, axis, x, radius, pitch, height, taper, leftHanded } = helix;
  if (!(radius > 0)) throw new HelixError('The diameter must be greater than zero.');
  if (!(pitch > 0)) throw new HelixError('The pitch must be greater than zero.');
  if (!(height > 0)) throw new HelixError('The height must be greater than zero.');
  if (!(Math.abs(taper) < (80 * Math.PI) / 180)) throw new HelixError('The taper must be less than 80°.');
  if (!(radius + height * Math.tan(taper) > 0)) throw new HelixError('The helix narrows to nothing before its end: use less taper or a smaller height.');
  const oc = getOC();
  const turns = height / pitch;
  const disposables: { delete(): void }[] = [];
  const keep = <T extends { delete(): void }>(value: T): T => (disposables.push(value), value);
  try {
    const ax3 = keep(new oc.gp_Ax3(keep(new oc.gp_Pnt(...origin)), keep(new oc.gp_Dir(...axis)), keep(new oc.gp_Dir(...x))));
    // On a cone, its parameter v runs along the slanted rulings: the rise per turn is pitch / cos(taper) of it.
    const surface = Math.abs(taper) > 1e-9 ? new oc.Geom_ConicalSurface(ax3, taper, radius) : new oc.Geom_CylindricalSurface(ax3, radius);
    const along = pitch / Math.cos(taper);
    const turnBy = (leftHanded ? -1 : 1) * 2 * Math.PI;
    const segment = keep(new oc.GC_MakeSegment2d(keep(new oc.gp_Pnt2d(0, 0)), keep(new oc.gp_Pnt2d(turnBy * turns, along * turns))));
    const edge = keep(new oc.BRepBuilderAPI_MakeEdge(keep(segment.Value()), surface)).Edge();
    const wire = keep(new oc.BRepBuilderAPI_MakeWire(edge)).Wire();
    oc.BRepLib.BuildCurves3d(wire);
    return new Wire(wire);
  } finally {
    for (const d of disposables.reverse()) d.delete();
  }
}

/**
 * A profile swept along a path: kept upright about `axis` (as threads are), or else turned with the
 * path by a discrete trihedron, which follows a spring's hooks and legs where the tangent runs along
 * its axis and a fixed one would fold the pipe.
 */
function sweepAlong(profile: Wire, path: Wire, axis?: Vec3): Shape3D {
  const oc = getOC();
  const builder = new oc.BRepOffsetAPI_MakePipeShell(path.wrapped);
  const binormal = axis ? new oc.gp_Dir(axis[0], axis[1], axis[2]) : undefined;
  try {
    if (binormal) builder.SetMode(binormal);
    else builder.SetDiscreteMode();
    builder.Add(profile.wrapped, false, false);
    builder.Build();
    builder.MakeSolid();
    return adopt(builder.Shape()) as Shape3D;
  } finally {
    builder.delete();
    binormal?.delete();
  }
}

/** Round wire of `diameter` along a path, starting at `start` where the path runs along `tangent`. */
function roundWire(path: Wire, start: Vec3, tangent: Vec3, diameter: number): Shape3D {
  return sweepAlong(assembleWire([makeCircle(diameter / 2, [...start], [...tangent])]), path);
}

/** A frame about a part's axis: origin, x across, y = n × x, n along. */
export interface AxisFrame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly n: Vec3;
}

const at = (f: AxisFrame, local: Vec3): Vec3 => add3(f.origin, add3(scale3(f.x, local[0]), add3(scale3(f.y, local[1]), scale3(f.n, local[2]))));

/**
 * A spring's centre line as one smooth curve through its points (local coordinates of the frame), and
 * where it starts and which way: swept as one piece, with no booleans between coils, hooks and legs.
 */
function centreLine(f: AxisFrame, points: readonly Vec3[]) {
  const world = points.map((p) => at(f, p));
  const wire = assembleWire([makeBSplineApproximation(world.map((p) => [...p] as [number, number, number]), { tolerance: 1e-4, degMax: 5, smoothing: null })]);
  const [first, second] = world as [Vec3, Vec3];
  return { wire, start: first, startDirection: normalize3(sub3(second, first)) };
}

/** Points of a coil of radius r about the frame's axis, from `from` to `to` turns, `rise(t)` high after t turns. */
function coilPoints(r: number, from: number, to: number, rise: (t: number) => number): Vec3[] {
  const steps = Math.max(12, Math.ceil((to - from) * 48));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / steps;
    return [r * Math.cos(2 * Math.PI * t), r * Math.sin(2 * Math.PI * t), rise(t)];
  });
}

/**
 * The height of a compression spring's coil after t of its turns: `pitch` per turn in its body; with
 * closed ends the rise eases from flat at each end of the wire into the body's pitch over the end turn,
 * keeping the coils at least a wire apart, so the free length is the usual one for the end type.
 */
function compressionRise(wire: number, pitch: number, turns: number, ends: 'open' | 'closed' | 'ground'): (t: number) => number {
  if (ends === 'open') return (t) => pitch * t;
  // A smooth step of the rise rate over `ramp` turns at each end: the coil rises pitch · (turns − ramp)
  // in all, which the usual length, pitch · (turns − 2) + 2 · wire, fixes. A little more than a wire
  // apart (2 %), so the end turns never quite touch the next.
  const spacing = 1.02 * wire;
  const ramp = 2 - (2 * spacing) / pitch;
  const eased = (u: number) => u ** 3 - u ** 4 / 2; // the integral of 3u² − 2u³
  const total = pitch * (turns - ramp);
  return (t) => {
    if (t <= ramp) return pitch * ramp * eased(t / ramp);
    if (t >= turns - ramp) return total - pitch * ramp * eased((turns - t) / ramp);
    return pitch * ramp * eased(1) + pitch * (t - ramp);
  };
}

/**
 * A helical spring of round wire (CAD-161), standing on the frame's plane about its axis, its wire's
 * end along x. Compression springs rise from the plane (ground ends are cut flat to it and to the free
 * length); extension springs have coils a wire apart and a loop bent up from the last coil at each end
 * (a side loop of the coil's diameter, 300° round); torsion springs have a straight leg at each end,
 * going on along the coil.
 */
export function springSolid(size: SpringSize, frame: AxisFrame): Shape3D {
  const { wire: d, mean, turns } = size;
  if (!(d > 0)) throw new HelixError('The wire must be thicker than zero.');
  if (!(mean > d)) throw new HelixError('The outside diameter must be more than twice the wire.');
  const r = mean / 2;
  const sweep = (points: readonly Vec3[]) => {
    const line = centreLine(frame, points);
    return roundWire(line.wire, line.start, line.startDirection, d);
  };
  switch (size.kind) {
    case 'compression': {
      if (!(turns >= (size.ends === 'open' ? 1 : 3))) throw new HelixError(size.ends === 'open' ? 'A spring needs at least one turn.' : 'A spring with closed ends needs at least 3 turns.');
      if (!(size.pitch > 1.05 * d)) throw new HelixError('The pitch must be more than the wire, or the coils touch.');
      const rise = compressionRise(d, size.pitch, turns, size.ends);
      // Ground ends: the wire's centre on the plane, then cut flat; otherwise the wire stands on the plane.
      const base = size.ends === 'ground' ? 0 : d / 2;
      const spring = sweep(coilPoints(r, 0, turns, (t) => base + rise(t)));
      if (size.ends !== 'ground') return spring;
      return spring.intersect(makeCylinder(r + d, rise(turns), [...frame.origin], [...frame.n]) as Shape3D);
    }
    case 'extension': {
      if (!(turns >= 2)) throw new HelixError('An extension spring needs at least 2 turns.');
      // Whole turns, so both ends of the coil lie on x; a little more than a wire apart (2 %).
      const count = Math.round(turns);
      const spacing = 1.02 * d;
      const top = spacing * count;
      // Each loop stands in the plane across x at the coil's end, going on the way the coil runs there.
      const loop = (z: number, up: 1 | -1, from: number, to: number): Vec3[] =>
        Array.from({ length: 41 }, (_, i) => {
          const angle = from + ((to - from) * i) / 40;
          return [r, r * Math.sin(angle), z + up * r * (1 - Math.cos(angle))];
        });
      const reach = (300 * Math.PI) / 180;
      const points = [...loop(0, -1, -reach, 0).slice(0, -1), ...coilPoints(r, 0, count, (t) => spacing * t), ...loop(top, 1, 0, reach).slice(1)];
      return sweep(points);
    }
    case 'torsion': {
      if (!(turns >= 1)) throw new HelixError('A spring needs at least one turn.');
      if (!(size.pitch >= d)) throw new HelixError('The pitch must be at least the wire, or the coils overlap.');
      if (!(size.legs > 0)) throw new HelixError('The legs must be longer than zero.');
      // The coils a little apart if they would touch.
      const pitch = Math.max(size.pitch, 1.02 * d);
      const coil = coilPoints(r, 0, turns, (t) => d / 2 + pitch * t);
      // Straight legs going on along the coil at both ends of the wire.
      const [first, second, before, last] = [coil[0], coil[1], coil[coil.length - 2], coil[coil.length - 1]] as [Vec3, Vec3, Vec3, Vec3];
      const [back, on] = [normalize3(sub3(first, second)), normalize3(sub3(last, before))];
      const leg = (from: Vec3, direction: Vec3) => Array.from({ length: 8 }, (_, i) => add3(from, scale3(direction, (size.legs * (i + 1)) / 8)));
      return sweep([...leg(first, back).reverse(), ...coil, ...leg(last, on)]);
    }
  }
}

/**
 * A worm (CAD-160): `starts` right-hand threads of axial module `module` (rack teeth in its axial
 * section, `pressureAngle` flanks, addendum m, dedendum 1.25 m) on a core, centred on the frame's
 * origin along its axis, `length` long, a thread crossing the frame's plane on its x axis.
 */
export function wormSolid(module: number, starts: number, diameter: number, length: number, pressureAngle: number, bore: number, frame: AxisFrame): Shape3D {
  const n = Math.round(starts);
  if (!(n >= 1)) throw new HelixError('A worm needs at least one start.');
  const lead = n * Math.PI * module;
  const [tip, root] = [diameter / 2 + module, diameter / 2 - 1.25 * module];
  if (!(root > bore / 2 + 0.2 * module)) throw new HelixError('The worm is too thin for its module and bore: use a smaller lead angle or bore.');
  const slope = Math.tan(pressureAngle);
  const [tipHalf, overlap] = [(Math.PI * module) / 4 - module * slope, 0.05 * module];
  if (!(tipHalf > 0)) throw new HelixError('The threads come to a point: use a smaller pressure angle.');
  const rootHalf = (Math.PI * module) / 4 + (1.25 * module + overlap) * slope;
  // The threads reach past both ends, a whole number of leads before the middle, then are cut to length.
  const before = (Math.ceil(length / 2 / lead) + 1) * lead;
  const helix = helixWire({ origin: at(frame, [0, 0, -before]), axis: frame.n, x: frame.x, radius: root - overlap, pitch: lead, height: 2 * before, taper: 0, leftHanded: false });
  const section = (radial: number, axial: number): Vec3 => at(frame, [radial, 0, -before + axial]);
  const corners = [section(root - overlap, -rootHalf), section(tip, -tipHalf), section(tip, tipHalf), section(root - overlap, rootHalf)];
  const profile = assembleWire(corners.map((c, i) => makeLine([...c], [...(corners[(i + 1) % corners.length] as Vec3)])));
  const thread = sweepAlong(profile, helix, frame.n);
  let worm = makeCylinder(root, 2 * before, [...at(frame, [0, 0, -before])], [...frame.n]) as Shape3D;
  for (let k = 0; k < n; k++) worm = worm.fuse(k === 0 ? thread : (thread.clone().rotate((360 * k) / n, [...frame.origin], [...frame.n]) as Shape3D));
  const cut = makeCylinder(tip + module, length, [...at(frame, [0, 0, -length / 2])], [...frame.n]) as Shape3D;
  worm = worm.intersect(cut);
  return bore > 0 ? worm.cut(makeCylinder(bore / 2, length + 2, [...at(frame, [0, 0, -length / 2 - 1])], [...frame.n]) as Shape3D) : worm;
}
