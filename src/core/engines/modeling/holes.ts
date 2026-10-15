import type { NamedShape } from '@core/access/shape';
import type { PlaneFrame, ThreadMarker, Vec2, Vec3 } from '@core/contracts';
import { assembleWire, cast, draw, type Drawing, type Face, getOC, makeHelix, makeLine, Plane, type Shape3D } from 'replicad';
import { add3, cross3, dot3, length3, normalize3, normalOf, scale3, sub3, toWorld } from './geometry';
import { nameShape, namedSurfaces } from './naming';
import type { Surface } from './surfaces';

/** What a hole looks like: its diameter, depth (absent: through everything), and the shape of its mouth. */
export interface HoleSpec {
  readonly diameter: number;
  readonly depth?: number;
  readonly bore?: { readonly diameter: number; readonly depth: number };
  readonly sink?: { readonly diameter: number; readonly angle: number };
  /** A pointed top, so a hole lying on its side prints without support. */
  readonly teardrop: boolean;
  /** Thickness of a layer left over the hole at the bottom of a counterbore (0: none). */
  readonly bridge: number;
}

/** A failure the user can act on. */
export class HoleError extends Error {}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

/** A teardrop outline around the origin of a plane: a circle with a 90° point towards local +y. */
function teardrop(radius: number): Drawing {
  const c = radius * Math.SQRT1_2;
  return draw([0, radius * Math.SQRT2]).lineTo([-c, c]).threePointsArcTo([c, c], [0, -radius]).close();
}

/**
 * One hole's cutting tool at `at`, going `down` into the material. Revolved from its half section,
 * or, as a teardrop, extruded from its outline; faces named `wall`, `bore`, `sink`, `floor`, `tip`
 * with the point's id.
 */
function oneHole(feature: string, id: string, at: Vec3, down: Vec3, across: Vec3, spec: HoleSpec, depth: number): NamedShape {
  const up = scale3(down, -1);
  const r = spec.diameter / 2;
  // Teardrops point up (+Z); only for holes that lie on their side.
  const lying = spec.teardrop && Math.abs(down[2]) < 0.7;
  const top: Vec3 = lying ? normalize3(sub3([0, 0, 1], scale3(down, down[2]))) : across;
  const pieces: Shape3D[] = [];
  const revolve = (section: [number, number][]) => {
    const [first, ...rest] = section;
    let pen = draw(first as [number, number]);
    for (const p of rest) pen = pen.lineTo(p);
    const plane = new Plane([...at], [...across], [...cross3(across, up)]);
    pieces.push(pen.close().sketchOnPlane(plane).revolve([...up], { origin: [...at] }) as Shape3D);
  };
  const extrude = (radius: number, from: number, to: number) => {
    const plane = new Plane([...add3(at, scale3(down, from))], [...normalize3(cross3(top, down))], [...down]);
    pieces.push(teardrop(radius).sketchOnPlane(plane).extrude(to - from) as Shape3D);
  };
  const cylinder = (radius: number, from: number, to: number) =>
    lying
      ? extrude(radius, from, to)
      : revolve([
          [0, -from],
          [radius, -from],
          [radius, -to],
          [0, -to],
        ]);
  let start = 0;
  if (spec.bore) {
    if (!(spec.bore.diameter > spec.diameter)) throw new HoleError('The counterbore has to be wider than the hole.');
    cylinder(spec.bore.diameter / 2, 0, spec.bore.depth);
    start = spec.bore.depth + spec.bridge;
  } else if (spec.sink) {
    const R = spec.sink.diameter / 2;
    if (!(R > r)) throw new HoleError('The countersink has to be wider than the hole.');
    const sink = (R - r) / Math.tan(spec.sink.angle / 2);
    revolve([
      [0, 0],
      [R, 0],
      [r, -sink],
      [0, -sink],
    ]);
    start = sink;
  }
  if (depth <= start + 1e-9) throw new HoleError('The hole is not deeper than its counterbore or countersink.');
  cylinder(r, start, depth);
  const [first, ...more] = pieces as [Shape3D, ...Shape3D[]];
  const shape = more.reduce((all, piece) => all.fuse(piece), first);
  const axisDistance = (p: Vec3) => length3(cross3(sub3(p, at), down));
  const fresh = (face: Face, surface: Surface): string => {
    const role = (() => {
      if (surface.type === 'cylinder') return near(surface.radius, r) ? 'wall' : 'bore';
      if (surface.type === 'plane') return Math.abs(dot3(surface.normal, down)) > 1 - 1e-6 ? 'floor' : 'tip';
      // The countersink is a cone, which the kernel build cannot read: the one other surface of a hole.
      return near(axisDistance(face.center.toTuple() as Vec3), r) ? 'wall' : spec.sink ? 'sink' : 'tip';
    })();
    return `f:${feature}:${role}:${id}`;
  };
  return nameShape(shape, [], fresh, feature);
}

/** All the holes of a hole feature as one cutting tool. */
export function holeTool(feature: string, frame: PlaneFrame, points: readonly { readonly id: string; readonly at: Vec2 }[], spec: HoleSpec, depth: number): NamedShape {
  if (!points.length) throw new HoleError('Put points in the sketch where the holes go.');
  if (!(spec.diameter > 0)) throw new HoleError('The hole diameter must be greater than zero.');
  const down = scale3(normalize3(normalOf(frame)), -1);
  const tools = points.map((p) => oneHole(feature, p.id, toWorld(frame, p.at), down, frame.u, spec, depth));
  const [first, ...rest] = tools as [NamedShape, ...NamedShape[]];
  if (!rest.length) return first;
  const shape = rest.reduce((all, t) => all.fuse(t.shape), first.shape);
  return nameShape(shape, tools.flatMap((t) => namedSurfaces(t)), () => undefined, feature);
}

/** Where a thread goes on a round face: its axis from the opening end, radius and length, and whether it is inside a hole. */
export function threadPlacement(face: Face, axis: { origin: Vec3; direction: Vec3 }, body: Shape3D, flip: boolean): { origin: Vec3; direction: Vec3; radius: number; length: number; internal: boolean } {
  const oc = getOC();
  const adaptor = new oc.BRepAdaptor_Surface(face.wrapped, false);
  let radius: number;
  try {
    radius = adaptor.Cylinder().Radius();
  } finally {
    adaptor.delete();
  }
  const along = (p: Vec3) => dot3(sub3(p, axis.origin), axis.direction);
  const facePoints = face.edges.flatMap((e) => [e.startPoint.toTuple(), e.endPoint.toTuple(), e.pointAt(0.5).toTuple()] as Vec3[]);
  const [tMin, tMax] = [Math.min(...facePoints.map(along)), Math.max(...facePoints.map(along))];
  const [low, high] = body.boundingBox.bounds as [Vec3, Vec3];
  const corners: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? high[0] : low[0], i & 2 ? high[1] : low[1], i & 4 ? high[2] : low[2]]);
  const [bMin, bMax] = [Math.min(...corners.map(along)), Math.max(...corners.map(along))];
  // The thread starts at the open end: the end of the face nearer the outside of the body.
  const fromLow = Math.abs(tMin - bMin) <= Math.abs(bMax - tMax) !== flip;
  // A point on the wall (a cylinder's centre of mass lies on its axis, where the normal is undefined).
  const onWall = face.pointOnSurface(0.5, 0.5).toTuple() as Vec3;
  const radial = sub3(onWall, add3(axis.origin, scale3(axis.direction, along(onWall))));
  const normal = face.normalAt([...onWall]).toTuple() as Vec3;
  return {
    origin: add3(axis.origin, scale3(axis.direction, fromLow ? tMin : tMax)),
    direction: fromLow ? axis.direction : scale3(axis.direction, -1),
    radius,
    length: tMax - tMin,
    internal: dot3(normal, radial) < 0,
  };
}

/** The groove of a modelled ISO metric thread (60° flanks), swept along a helix and ready to cut. */
export function threadGroove(marker: ThreadMarker): Shape3D {
  const oc = getOC();
  const { origin, direction, radius, length, pitch, diameter, internal } = marker;
  // Internal threads cut outwards from the hole to the major diameter; external ones inwards to the minor diameter.
  const depth = internal ? diameter / 2 - radius : 0.6134 * pitch;
  if (!(depth > 0)) throw new HoleError('This hole is already as wide as the thread.');
  const overlap = 0.05 * pitch;
  const helix = makeHelix(pitch, length, radius, [...origin], [...direction]);
  const start = helix.edges[0]?.startPoint.toTuple() as Vec3;
  const out = normalize3(sub3(start, add3(origin, scale3(direction, dot3(sub3(start, origin), direction)))));
  const inward = internal ? out : scale3(out, -1);
  const half = (depth + overlap) * Math.tan(Math.PI / 6);
  const base = add3(start, scale3(inward, -overlap));
  const [a, b, c] = [add3(base, scale3(direction, half)), add3(base, scale3(direction, -half)), add3(start, scale3(inward, depth))];
  const profile = assembleWire([makeLine([...a], [...b]), makeLine([...b], [...c]), makeLine([...c], [...a])]);
  const builder = new oc.BRepOffsetAPI_MakePipeShell(helix.wrapped);
  const binormal = new oc.gp_Dir(direction[0], direction[1], direction[2]);
  try {
    builder.SetMode(binormal);
    builder.Add(profile.wrapped, false, false);
    builder.Build();
    builder.MakeSolid();
    return cast(builder.Shape()) as Shape3D;
  } finally {
    builder.delete();
    binormal.delete();
  }
}
