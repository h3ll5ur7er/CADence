import { adopt, type NamedShape } from '@core/access/shape';
import type { PlaneFrame, Profile, ProfileEdge, Vec2, Vec3 } from '@core/contracts';
import { curveAt, ellipseParameter } from '@core/utilities/math';
import { assembleWire, type Drawing, type Edge, type Face, getOC, measureArea, Sketches, makeBezierCurve, makeLine, makeThreePointArc, makeVertex, type Shape3D, type Sketch, type Wire } from 'replicad';
import { cross3, dot3, length3, normalize3, normalOf, scale3, sub3, toPlane, toWorld, add3 } from './geometry';
import { nameShape, namedSurfaces } from './naming';
import { type Line, sameLine, samePlaneIgnoringSide, type Surface } from './surfaces';
import { loopDrawing, profilesDrawing } from './geometry';
import type { PathPiece } from './modeling-engine';
import { cut, fuse, valid } from './booleans';
import { alignSections } from './sections';

/** A revolve the kernel cannot build, in words for the user. */
export class RevolveError extends Error {}

/** The surface a profile edge sweeps out, to recognise which tool face it made. */
interface Expected {
  readonly source: string;
  readonly matches: (surface: Surface, face: Face) => boolean;
  /** A point the face passes through: where the edge's middle went, halfway along the sweep. */
  readonly point: Vec3;
}

/** A point halfway along a free-form profile edge (a spline piece or an ellipse piece). */
function middleOf(edge: Extract<ProfileEdge, { kind: 'bezier' | 'ellipse' }>): Vec2 {
  if (edge.kind === 'bezier') return curveAt({ kind: 'bezier', points: [edge.start, edge.c1, edge.c2, edge.end] }, 0.5);
  const ellipse = { center: edge.center, a: edge.a, b: edge.b, rotation: edge.rotation };
  const t0 = ellipseParameter(ellipse, edge.start);
  let t1 = ellipseParameter(ellipse, edge.end);
  if (edge.ccw) while (t1 <= t0 + 1e-12) t1 += 2 * Math.PI;
  else while (t1 >= t0 - 1e-12) t1 -= 2 * Math.PI;
  return curveAt({ kind: 'ellipse', ellipse }, (t0 + t1) / 2);
}

/** Whether a point lies on a face: free-form side faces are recognised by a point they must pass through. */
function passesThrough(face: Face, point: Vec3): boolean {
  const tool = new (getOC().BRepExtrema_DistShapeShape)();
  try {
    tool.LoadS1(face.wrapped);
    tool.LoadS2(makeVertex([...point]).wrapped);
    tool.Perform();
    return tool.IsDone() && tool.Value() < 1e-4;
  } finally {
    tool.delete();
  }
}

/** A point turned about an axis (Rodrigues' rotation). */
function rotateAbout(p: Vec3, axis: { readonly origin: Vec3; readonly direction: Vec3 }, angle: number): Vec3 {
  const k = normalize3(axis.direction);
  const v = sub3(p, axis.origin);
  const cos = Math.cos(angle);
  const turned = add3(add3(scale3(v, cos), scale3(cross3(k, v), Math.sin(angle))), scale3(k, dot3(k, v) * (1 - cos)));
  return add3(axis.origin, turned);
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
const distanceToLine = (p: Vec3, line: Line) => length3(cross3(sub3(p, line.point), line.direction));

function edgesOf(profiles: readonly Profile[]): ProfileEdge[] {
  return profiles.flatMap((p) => [p.outer, ...p.holes].flatMap((loop) => loop.edges));
}

/**
 * Names tool faces: caps by position, sides by the sketch curve that swept them. Pieces of different
 * sketch curves can sweep one surface (the lines of two outlines at one radius): then a face is named
 * after the curve whose middle it passes through (CAD-104).
 */
function nameTool(
  shape: Shape3D,
  feature: string,
  expected: readonly Expected[],
  cap: (surface: Surface, face: Face) => string | undefined,
): NamedShape {
  return nameShape(
    shape,
    [],
    (face, surface) => {
      const capName = cap(surface, face);
      if (capName) return `f:${feature}:${capName}`;
      const sides = expected.filter((e) => e.matches(surface, face));
      const side = new Set(sides.map((s) => s.source)).size > 1 ? (sides.find((s) => passesThrough(face, s.point)) ?? sides[0]) : sides[0];
      return side ? `f:${feature}:side:${side.source}` : undefined;
    },
    feature,
  );
}

/** The area a drawing covers. */
function drawnArea(drawing: Drawing): number {
  const sketch = drawing.clone().sketchOnPlane('XY');
  const faces = (sketch instanceof Sketches ? sketch.faces() : sketch.face()) as Face;
  try {
    return measureArea(faces);
  } finally {
    faces.delete();
  }
}

/**
 * The profiles made solid by `make`, from one drawing of them all. Fusing the outlines in the plane
 * can lose pieces, or give something invalid, where shapes overlap (their profiles share edges, and
 * slivers lie between them, CAD-138): then each profile is made solid on its own and the solids are
 * fused. The profiles do not overlap, so their drawing covers their areas together.
 */
function solidOf(profiles: readonly Profile[], make: (drawing: Drawing) => Shape3D): Shape3D {
  if (profiles.length < 2) return make(profilesDrawing(profiles));
  const drawing = profilesDrawing(profiles);
  const area = profiles.reduce((sum, profile) => sum + profile.area, 0);
  if (Math.abs(drawnArea(drawing) - area) <= 1e-4 * area + 1e-6) {
    const shape = make(drawing);
    if (valid(shape)) return shape;
    shape.delete();
  }
  const [first, ...rest] = profiles.map((profile) => make(profilesDrawing([profile]))) as [Shape3D, ...Shape3D[]];
  const fused = fuse(first, ...rest);
  for (const solid of [first, ...rest]) solid.delete();
  return fused;
}

export function extrudeTool(
  feature: string,
  frame: PlaneFrame,
  profiles: readonly Profile[],
  distance: number,
  direction: 'normal' | 'reverse' | 'symmetric',
): NamedShape {
  const n = normalOf(frame);
  const shape3d = solidOf(profiles, (drawing) =>
    direction === 'symmetric'
      ? (drawing.sketchOnPlane(toPlane(frame, -distance / 2)).extrude(distance) as Shape3D)
      : (drawing.sketchOnPlane(toPlane(frame)).extrude(distance, direction === 'reverse' ? { extrusionDirection: [...scale3(n, -1)] } : {}) as Shape3D),
  );
  // Caps: planes normal to the extrusion; the one nearer the sketch's side of travel is "start".
  const [low, high] = direction === 'normal' ? [0, distance] : direction === 'reverse' ? [-distance, 0] : [-distance / 2, distance / 2];
  const along = (offset: number) => offset - dot3(n, frame.origin);
  const cap = (surface: Surface) => {
    if (surface.type !== 'plane' || !near(Math.abs(dot3(surface.normal, n)), 1)) return undefined;
    const t = along(dot3(surface.normal, n) > 0 ? surface.offset : -surface.offset);
    return Math.abs(t - low) < Math.abs(t - high) ? 'start' : 'end';
  };
  const expected = edgesOf(profiles).map((edge): Expected => {
    const point = add3(toWorld(frame, midOf(edge)), scale3(n, (low + high) / 2));
    if (edge.kind === 'bezier' || edge.kind === 'ellipse') {
      return { source: edge.source, point, matches: (s, face) => s.type === 'other' && passesThrough(face, point) };
    }
    if (edge.kind === 'line') {
      const p = toWorld(frame, edge.start);
      const normal = normalize3(cross3(sub3(toWorld(frame, edge.end), p), n));
      const plane: Surface = { type: 'plane', normal, offset: dot3(normal, p) };
      return { source: edge.source, point, matches: (s) => samePlaneIgnoringSide(s, plane) };
    }
    const axis: Line = { point: toWorld(frame, edge.center), direction: n };
    return { source: edge.source, point, matches: (s) => s.type === 'cylinder' && near(s.radius, edge.radius) && sameLine(s.axis, axis) };
  });
  return nameTool(shape3d, feature, expected, cap);
}

export function revolveTool(
  feature: string,
  frame: PlaneFrame,
  profiles: readonly Profile[],
  axis: { readonly origin: Vec3; readonly direction: Vec3 },
  angle: number,
): NamedShape {
  const direction = normalize3(axis.direction);
  const line: Line = { point: axis.origin, direction };
  // The kernel only answers "command not done" for an outline across the axis, even by 0.0005 mm (CAD-118).
  const across = acrossAxis(frame, profiles, { origin: axis.origin, direction });
  if (across > 1e-7) {
    throw new RevolveError(`The outline crosses the axis (by ${Number(across.toPrecision(3))} mm). A revolve needs the whole outline on one side of its axis: move it, or put its edge on the axis exactly.`);
  }
  const shape = solidOf(profiles, (drawing) => drawing.sketchOnPlane(toPlane(frame)).revolve([...direction], { origin: [...axis.origin], angle: (angle * 180) / Math.PI }) as Shape3D);
  // Caps are planes through the axis; the start cap is on the profile's side of the axis.
  const radial = (p: Vec3) => {
    const w = sub3(p, axis.origin);
    return normalize3(sub3(w, scale3(direction, dot3(w, direction))));
  };
  const firstEdge = edgesOf(profiles)[0];
  const profileSide = firstEdge ? radial(toWorld(frame, firstEdge.start)) : ([1, 0, 0] as Vec3);
  const cap = (surface: Surface, face: Face) => {
    if (surface.type !== 'plane' || !near(dot3(surface.normal, direction), 0) || distanceToPlane(axis.origin, surface) > 1e-5) return undefined;
    return dot3(radial(face.center.toTuple() as Vec3), profileSide) > 1 - 1e-6 ? 'start' : 'end';
  };
  const expected = edgesOf(profiles).map((edge): Expected => {
    const point = rotateAbout(toWorld(frame, midOf(edge)), axis, angle / 2);
    if (edge.kind === 'bezier' || edge.kind === 'ellipse') {
      return { source: edge.source, point, matches: (s, face) => s.type === 'other' && passesThrough(face, point) };
    }
    if (edge.kind === 'line') {
      const [p, q] = [toWorld(frame, edge.start), toWorld(frame, edge.end)];
      const d = normalize3(sub3(q, p));
      const along = dot3(d, direction);
      if (near(Math.abs(along), 1)) {
        const radius = distanceToLine(p, line);
        return { source: edge.source, point, matches: (s) => s.type === 'cylinder' && near(s.radius, radius) && sameLine(s.axis, line) };
      }
      if (near(along, 0)) {
        const plane: Surface = { type: 'plane', normal: direction, offset: dot3(direction, p) };
        return { source: edge.source, point, matches: (s) => samePlaneIgnoringSide(s, plane) };
      }
      // A slanted line sweeps a cone, which the kernel build cannot read: recognised by a point it passes through.
      return { source: edge.source, point, matches: (s, face) => s.type === 'other' && passesThrough(face, point) };
    }
    const center = toWorld(frame, edge.center);
    const offAxis = distanceToLine(center, line);
    if (offAxis < 1e-6) return { source: edge.source, point, matches: (s) => s.type === 'sphere' && near(s.radius, edge.radius) };
    // A torus: the kernel build cannot read its radii (gp_Torus is not bound), so it is recognised by a point it passes through.
    return { source: edge.source, point, matches: (s, face) => s.type === 'other' && passesThrough(face, point) };
  });
  return nameTool(shape, feature, expected, cap);
}

function distanceToPlane(p: Vec3, plane: Extract<Surface, { type: 'plane' }>): number {
  return Math.abs(dot3(plane.normal, p) - plane.offset);
}

/** A point halfway along any profile edge, where the face it sweeps or lofts must pass. */
/** How far an outline reaches across an axis in its plane, on the side it reaches less (0 when it stays on one side). */
function acrossAxis(frame: PlaneFrame, profiles: readonly Profile[], axis: { readonly origin: Vec3; readonly direction: Vec3 }): number {
  const normal = normalOf(frame);
  // An axis out of the outline's plane has no sides in it.
  if (Math.abs(dot3(normal, axis.direction)) > 1e-9) return 0;
  const across = normalize3(cross3(normal, axis.direction));
  let [low, high] = [0, 0];
  for (const edge of edgesOf(profiles)) {
    for (const point of [edge.start, midOf(edge), edge.end]) {
      const side = dot3(sub3(toWorld(frame, point), axis.origin), across);
      [low, high] = [Math.min(low, side), Math.max(high, side)];
    }
  }
  return Math.min(-low, high);
}

function midOf(edge: ProfileEdge): Vec2 {
  if (edge.kind === 'bezier' || edge.kind === 'ellipse') return middleOf(edge);
  if (edge.kind === 'line') return [(edge.start[0] + edge.end[0]) / 2, (edge.start[1] + edge.end[1]) / 2];
  const a0 = Math.atan2(edge.start[1] - edge.center[1], edge.start[0] - edge.center[0]);
  const a1 = Math.atan2(edge.end[1] - edge.center[1], edge.end[0] - edge.center[0]);
  let sweep = edge.ccw ? a1 - a0 : a0 - a1;
  while (sweep <= 1e-12) sweep += 2 * Math.PI;
  const mid = a0 + (edge.ccw ? sweep : -sweep) / 2;
  return [edge.center[0] + edge.radius * Math.cos(mid), edge.center[1] + edge.radius * Math.sin(mid)];
}

/** A loop of a profile as a wire on its sketch plane. */
function wireOf(loop: Profile['outer'], frame: PlaneFrame): Wire {
  return (loopDrawing(loop).sketchOnPlane(toPlane(frame)) as Sketch).wire;
}

const planeOf = (frame: PlaneFrame): Surface => {
  const normal = normalOf(frame);
  return { type: 'plane', normal, offset: dot3(normal, frame.origin) };
};

/** The edges of a profile wire with the sketch curve each came from (nearest by its middle). */
function sourcedEdges(wire: Wire, edges: readonly ProfileEdge[], frame: PlaneFrame): { edge: Edge; source: string }[] {
  const middles = edges.map((e) => ({ source: e.source, at: toWorld(frame, midOf(e)) }));
  return wire.edges.map((edge) => {
    const middle = edge.pointAt(0.5).toTuple() as Vec3;
    const nearest = [...middles].sort((a, b) => length3(sub3(a.at, middle)) - length3(sub3(b.at, middle)))[0];
    return { edge, source: nearest?.source ?? 'edge' };
  });
}

/** The faces a builder made from each profile edge (its history), by face hash. */
function generatedNames(builder: { Generated(s: unknown): { IsEmpty(): boolean; First(): unknown; RemoveFirst(): void } }, sourced: readonly { edge: Edge; source: string }[], feature: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const { edge, source } of sourced) {
    const list = builder.Generated(edge.wrapped);
    while (!list.IsEmpty()) {
      const generated = adopt(list.First() as never);
      if ('normalAt' in generated) names.set((generated as Face).hashCode, `f:${feature}:side:${source}`);
      list.RemoveFirst();
    }
  }
  return names;
}

/** Names a lofted or swept solid: sides from the builder's history, caps by their planes. */
function nameFromHistory(shape: Shape3D, feature: string, sides: ReadonlyMap<number, string>, cap: (surface: Surface) => string | undefined): NamedShape {
  return nameShape(shape, [], (face, surface) => sides.get(face.hashCode) ?? (cap(surface) ? `f:${feature}:${cap(surface)}` : undefined), feature);
}

/**
 * A loft through the outer outlines of the sections, in order, lined up so they do not twist
 * ({@link alignSections}). Caps are `start` (first section) and `end` (last); sides are named after
 * the edge of the first section they start from.
 */
export function loftTool(feature: string, sections: readonly { readonly frame: PlaneFrame; readonly profile: Profile }[], ruled: boolean): NamedShape {
  const [first, last] = [sections[0], sections[sections.length - 1]];
  if (!first || !last || sections.length < 2) throw new Error('A loft needs at least two sections.');
  const oc = getOC();
  const loops = alignSections(sections.map((s) => ({ frame: s.frame, loop: s.profile.outer })));
  const wires = sections.map((s, i) => wireOf(loops[i] as Profile['outer'], s.frame));
  const builder = new oc.BRepOffsetAPI_ThruSections(true, ruled, 1e-6);
  try {
    builder.CheckCompatibility(false); // the sections are lined up already
    for (const wire of wires) builder.AddWire(wire.wrapped);
    builder.Build();
    const shape = adopt(builder.Shape()) as Shape3D;
    const sides = generatedNames(builder as never, sourcedEdges(wires[0] as Wire, first.profile.outer.edges, first.frame), feature);
    const cap = (surface: Surface) => (samePlaneIgnoringSide(surface, planeOf(first.frame)) ? 'start' : samePlaneIgnoringSide(surface, planeOf(last.frame)) ? 'end' : undefined);
    return nameFromHistory(shape, feature, sides, cap);
  } finally {
    builder.delete();
  }
}

/** One loop swept along the spine, its sides named from the sweep's history. */
function sweptLoop(feature: string, loop: Profile['outer'], frame: PlaneFrame, spine: Wire, cap: (surface: Surface) => string | undefined): NamedShape {
  const oc = getOC();
  const wire = wireOf(loop, frame);
  const builder = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
  try {
    builder.SetTransitionMode(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner);
    builder.Add(wire.wrapped, false, false);
    builder.Build();
    builder.MakeSolid();
    const shape = adopt(builder.Shape()) as Shape3D;
    return nameFromHistory(shape, feature, generatedNames(builder as never, sourcedEdges(wire, loop.edges, frame), feature), cap);
  } finally {
    builder.delete();
  }
}

function edgeOf(piece: PathPiece): Edge {
  if (piece.kind === 'line') return makeLine([...piece.start], [...piece.end]);
  if (piece.kind === 'arc') return makeThreePointArc([...piece.start], [...piece.mid], [...piece.end]);
  return makeBezierCurve(piece.points.map((p) => [...p] as [number, number, number]));
}

/** Where a path ends and the direction it runs there. */
function pathEnd(piece: PathPiece): { point: Vec3; direction: Vec3 } {
  if (piece.kind === 'line') return { point: piece.end, direction: normalize3(sub3(piece.end, piece.start)) };
  if (piece.kind === 'bezier') return { point: piece.points[3], direction: normalize3(sub3(piece.points[3], piece.points[2])) };
  // The arc's tangent at its end: perpendicular to the radius, turning the way it runs.
  const [a, b, c] = [piece.start, piece.mid, piece.end];
  const normal = normalize3(cross3(sub3(b, a), sub3(c, b)));
  const ab = sub3(b, a);
  const ac = sub3(c, a);
  const n = cross3(ab, ac);
  const center = add3(a, scale3(add3(scale3(cross3(n, ab), dot3(ac, ac)), scale3(cross3(ac, n), dot3(ab, ab))), 1 / (2 * dot3(n, n))));
  return { point: c, direction: normalize3(cross3(normal, sub3(c, center))) };
}

/**
 * Profiles swept along a path (holes are swept and cut out). Caps are `start` (the profile's plane)
 * and `end`; sides are named after the profile edge they come from, along the whole path.
 */
export function sweepTool(feature: string, frame: PlaneFrame, profiles: readonly Profile[], path: readonly PathPiece[], closed: boolean): NamedShape {
  const spine = assembleWire(path.map(edgeOf));
  const end = pathEnd(path[path.length - 1] as PathPiece);
  const endPlane: Surface = { type: 'plane', normal: end.direction, offset: dot3(end.direction, end.point) };
  const cap = (surface: Surface) => (closed ? undefined : samePlaneIgnoringSide(surface, planeOf(frame)) ? 'start' : samePlaneIgnoringSide(surface, endPlane) ? 'end' : undefined);
  let result: NamedShape | undefined;
  for (const profile of profiles) {
    let solid = sweptLoop(feature, profile.outer, frame, spine, cap);
    for (const hole of profile.holes) {
      const cutter = sweptLoop(feature, hole, frame, spine, cap);
      solid = nameShape(cut(solid.shape, cutter.shape), [...namedSurfaces(solid, 'tool'), ...namedSurfaces(cutter, 'tool')], () => undefined, feature);
    }
    result = result ? nameShape(fuse(result.shape, solid.shape), [...namedSurfaces(result, 'tool'), ...namedSurfaces(solid, 'tool')], () => undefined, feature) : solid;
  }
  if (!result) throw new Error('Select at least one profile.');
  return result;
}
