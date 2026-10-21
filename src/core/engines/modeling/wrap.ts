import { adopt, type NamedShape } from '@core/access/shape';
import type { PlaneFrame, Profile, ProfileEdge, ProfileLoop, Vec2, Vec3 } from '@core/contracts';
import { ccwSweep, curveAt, ellipseParameter } from '@core/utilities/math';
import { CompoundBlueprint, type CompoundSketch, draw, Drawing, Face, getOC, makeCompound, makeOffset, makeVertex, measureVolume, type Shape3D, type Sketch, Sketches } from 'replicad';
import { fuse, intersect } from './booleans';
import { add3, cross3, dot3, length3, normalize3, normalOf, profilesDrawing, scale3, sub3, toPlane, toWorld } from './geometry';
import { nameShape } from './naming';

/** A wrap the kernel cannot build, in words for the user. */
export class WrapError extends Error {}

/** A piece of a loop in the face's (u, v) parameters; an ellipse piece's rotation is in degrees. */
type Piece =
  | { readonly kind: 'line'; readonly a: Vec2; readonly b: Vec2 }
  | { readonly kind: 'bezier'; readonly a: Vec2; readonly c1: Vec2; readonly c2: Vec2; readonly b: Vec2 }
  | { readonly kind: 'ellipse'; readonly a: Vec2; readonly b: Vec2; readonly mid: Vec2; readonly rx: number; readonly ry: number; readonly rotation: number; readonly large: boolean; readonly ccw: boolean };

/** A 2 x 2 matrix by rows. */
type Matrix2 = readonly [Vec2, Vec2];

/**
 * How sketch points land on a surface: their (u, v) there (an affine map on a cylinder, so lines,
 * arcs and Béziers stay exact), and the surface moved `offset` along its normal, with the shift of
 * (u, v) that keeps points on their normals.
 */
interface Unrolling {
  readonly uv: (p: Vec2) => Vec2;
  readonly linear?: { readonly m: Matrix2; readonly t: Vec2 };
  readonly surface: (offset: number) => { readonly surface: unknown; readonly shift: Vec2 };
  /** The surface's normal (away from its axis) at a point near it. */
  readonly normal: (p: Vec3) => Vec3;
}

interface Xyz {
  X(): number;
  Y(): number;
  Z(): number;
}
interface Ax3 {
  Location(): Xyz;
  Direction(): Xyz;
}
const tuple = (p: Xyz): Vec3 => [p.X(), p.Y(), p.Z()];
const perpendicular = (v: Vec3, axis: Vec3): Vec3 => sub3(v, scale3(axis, dot3(v, axis)));

/** The centre of the circle through three points. */
function circumcenter(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const [ab, ac] = [sub3(b, a), sub3(c, a)];
  const normal = cross3(ab, ac);
  const toCenter = scale3(add3(scale3(cross3(normal, ab), dot3(ac, ac)), scale3(cross3(ac, normal), dot3(ab, ab))), 1 / (2 * dot3(normal, normal)));
  return add3(a, toCenter);
}

/**
 * A conical face's apex, axis (the way it widens) and half angle, from points on it: the kernel
 * build reads no cones (ADR-54b). Two circles across it give the axis and how fast it widens.
 */
function coneOf(face: Face): { apex: Vec3; axis: Vec3; angle: number } {
  const ring = (v: number) => {
    const [a, b, c] = [0.1, 0.5, 0.9].map((u) => face.pointOnSurface(u, v).toTuple() as Vec3) as [Vec3, Vec3, Vec3];
    const center = circumcenter(a, b, c);
    return { center, radius: length3(sub3(a, center)) };
  };
  const [near, far] = [ring(0.2), ring(0.8)];
  const wider = far.radius > near.radius;
  const [small, large] = wider ? [near, far] : [far, near];
  const span = length3(sub3(large.center, small.center));
  if (!(span > 1e-9) || !(large.radius - small.radius > 1e-9)) throw new WrapError('This cone could not be read; wrap onto another face.');
  const axis = normalize3(sub3(large.center, small.center));
  const angle = Math.atan((large.radius - small.radius) / span);
  return { apex: sub3(large.center, scale3(axis, large.radius / Math.tan(angle))), axis, angle };
}

/** The sketch's (u, v) to the face's: rolled out from where the sketch touches a cylinder or cone. */
function unrolling(face: Face, frame: PlaneFrame): Unrolling {
  const oc = getOC();
  const n = normalOf(frame);
  const adaptor = new oc.BRepAdaptor_Surface(face.wrapped, false);
  const point = (p: Vec3) => new oc.gp_Pnt(p[0], p[1], p[2]);
  const dir = (p: Vec3) => new oc.gp_Dir(p[0], p[1], p[2]);
  try {
    if (face.geomType === 'CYLINDRE') {
      const cylinder = adaptor.Cylinder() as unknown as { Position(): Ax3; Radius(): number };
      const position = cylinder.Position();
      const [c, axis, radius] = [tuple(position.Location()), normalize3(tuple(position.Direction())), cylinder.Radius()];
      if (Math.abs(dot3(n, axis)) > 1e-6) throw new WrapError('Wrapping onto a cylinder needs a sketch on a plane along its axis.');
      // The line where the sketch touches the cylinder: on the side the sketch is on.
      const side = dot3(sub3(frame.origin, c), n) < -1e-6 ? -1 : 1;
      const r0 = normalize3(scale3(perpendicular(n, axis), side));
      const t0 = cross3(axis, r0);
      if (!(radius > 0)) throw new WrapError('This cylinder has no radius.');
      const place = new oc.gp_Ax3(point(c), dir(axis), dir(r0));
      const uv = (p: Vec2): Vec2 => {
        const d = sub3(toWorld(frame, p), c);
        return [dot3(d, t0) / radius, dot3(d, axis)];
      };
      const from = sub3(frame.origin, c);
      const m: Matrix2 = [
        [dot3(frame.u, t0) / radius, dot3(frame.v, t0) / radius],
        [dot3(frame.u, axis), dot3(frame.v, axis)],
      ];
      return {
        uv,
        linear: { m, t: [dot3(from, t0) / radius, dot3(from, axis)] },
        surface: (offset) => ({ surface: new oc.Geom_CylindricalSurface(place, radius + offset), shift: [0, 0] }),
        normal: (p) => normalize3(perpendicular(sub3(p, c), axis)),
      };
    }
    if (face.geomType === 'CONE') {
      const { apex, axis, angle } = coneOf(face);
      const across = perpendicular(n, axis);
      if (length3(across) < 1e-6) throw new WrapError('Wrapping onto a cone needs a sketch on a plane along it, not across its axis.');
      const side = dot3(sub3(frame.origin, apex), across) < -1e-6 ? -1 : 1;
      const r0 = normalize3(scale3(across, side));
      const t0 = cross3(axis, r0);
      // Measured in the sketch plane from the apex (seen on it): along the axis, and round.
      const apexSeen = sub3(apex, scale3(n, dot3(sub3(apex, frame.origin), n)));
      const along = normalize3(perpendicular(axis, n));
      const round = normalize3(perpendicular(t0, n));
      const h0 = 1;
      const place = new oc.gp_Ax3(point(add3(apex, scale3(axis, h0))), dir(axis), dir(r0));
      const uv = (p: Vec2): Vec2 => {
        const d = sub3(toWorld(frame, p), apexSeen);
        const [l, w] = [dot3(d, along), dot3(d, round)];
        // The cone rolled out is a sector: distance from the apex, and angle turned by 1 / sin.
        return [Math.atan2(w, l) / Math.sin(angle), Math.hypot(l, w) - h0 / Math.cos(angle)];
      };
      return {
        uv,
        // Moved along its normal, a cone keeps its angle and widens by offset / cos; v shifts by offset x tan.
        surface: (offset) => ({ surface: new oc.Geom_ConicalSurface(place, angle, h0 * Math.tan(angle) + offset / Math.cos(angle)), shift: [0, -offset * Math.tan(angle)] }),
        normal: (p) => add3(scale3(normalize3(perpendicular(sub3(p, apex), axis)), Math.cos(angle)), scale3(axis, -Math.sin(angle))),
      };
    }
  } finally {
    adaptor.delete();
  }
  throw new WrapError('Wrap goes onto cylinders and cones; project the sketch onto other faces.');
}

/** An edge as a curve of a parameter: its point and derivative, from `t0` by `sweep`, in `count` even steps. */
interface Parametric {
  readonly at: (t: number) => Vec2;
  readonly tangent: (t: number) => Vec2;
  readonly t0: number;
  readonly sweep: number;
  readonly count: number;
}

const steps = (sweep: number) => Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 4)));

function parametric(edge: ProfileEdge): Parametric {
  switch (edge.kind) {
    case 'line': {
      const d = sub2(edge.end, edge.start);
      return { at: (t) => add2(edge.start, scale2(d, t)), tangent: () => d, t0: 0, sweep: 1, count: 3 };
    }
    case 'arc': {
      const a0 = Math.atan2(edge.start[1] - edge.center[1], edge.start[0] - edge.center[0]);
      const a1 = Math.atan2(edge.end[1] - edge.center[1], edge.end[0] - edge.center[0]);
      const sweep = edge.ccw ? ccwSweep(a0, a1) : -ccwSweep(a1, a0);
      const r = edge.radius;
      return { at: (t) => [edge.center[0] + r * Math.cos(t), edge.center[1] + r * Math.sin(t)], tangent: (t) => [-r * Math.sin(t), r * Math.cos(t)], t0: a0, sweep, count: steps(sweep) };
    }
    case 'bezier': {
      const { start: s0, c1, c2, end: s3 } = edge;
      return {
        at: (t) => curveAt({ kind: 'bezier', points: [s0, c1, c2, s3] }, t),
        tangent: (t) => add2(add2(scale2(sub2(c1, s0), 3 * (1 - t) ** 2), scale2(sub2(c2, c1), 6 * (1 - t) * t)), scale2(sub2(s3, c2), 3 * t * t)),
        t0: 0,
        sweep: 1,
        count: 3,
      };
    }
    case 'ellipse': {
      const ellipse = { center: edge.center, a: edge.a, b: edge.b, rotation: edge.rotation };
      const t0 = ellipseParameter(ellipse, edge.start);
      const t1 = ellipseParameter(ellipse, edge.end);
      const sweep = edge.ccw ? ccwSweep(t0, t1) : -ccwSweep(t1, t0);
      const [cos, sin] = [Math.cos(edge.rotation), Math.sin(edge.rotation)];
      const turn = ([x, y]: Vec2): Vec2 => [cos * x - sin * y, sin * x + cos * y];
      return { at: (t) => curveAt({ kind: 'ellipse', ellipse }, t), tangent: (t) => turn([-edge.a * Math.sin(t), edge.b * Math.cos(t)]), t0, sweep, count: steps(sweep) };
    }
  }
}

const apply2 = (m: Matrix2, p: Vec2): Vec2 => [m[0][0] * p[0] + m[0][1] * p[1], m[1][0] * p[0] + m[1][1] * p[1]];
const times2 = (a: Matrix2, b: Matrix2): Matrix2 => [
  [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
  [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
];

/** The ellipse a matrix makes of the unit circle: its half axes and the direction of the first (radians). */
function ellipseOfMatrix(a: Matrix2): { rx: number; ry: number; rotation: number } {
  // The eigenvalues of A Aᵀ are the squared half axes; its first eigenvector is the long axis.
  const p = a[0][0] ** 2 + a[0][1] ** 2;
  const q = a[0][0] * a[1][0] + a[0][1] * a[1][1];
  const r = a[1][0] ** 2 + a[1][1] ** 2;
  const mean = (p + r) / 2;
  const spread = Math.hypot((p - r) / 2, q);
  return { rx: Math.sqrt(mean + spread), ry: Math.sqrt(Math.max(0, mean - spread)), rotation: 0.5 * Math.atan2(2 * q, p - r) };
}

/** An edge in (u, v) under an affine map: exactly, as a line, a Bézier or an ellipse. */
function affinePieces(edge: ProfileEdge, m: Matrix2, t: Vec2): Piece[] {
  const map = (p: Vec2) => add2(apply2(m, p), t);
  const flips = m[0][0] * m[1][1] - m[0][1] * m[1][0] < 0;
  switch (edge.kind) {
    case 'line':
      return [{ kind: 'line', a: map(edge.start), b: map(edge.end) }];
    case 'bezier':
      return [{ kind: 'bezier', a: map(edge.start), c1: map(edge.c1), c2: map(edge.c2), b: map(edge.end) }];
    case 'arc':
    case 'ellipse': {
      const shape: Matrix2 =
        edge.kind === 'arc'
          ? [
              [edge.radius, 0],
              [0, edge.radius],
            ]
          : [
              [edge.a * Math.cos(edge.rotation), -edge.b * Math.sin(edge.rotation)],
              [edge.a * Math.sin(edge.rotation), edge.b * Math.cos(edge.rotation)],
            ];
      const { rx, ry, rotation } = ellipseOfMatrix(times2(m, shape));
      const curve = parametric(edge);
      const mid = map(curve.at(curve.t0 + curve.sweep / 2));
      return [{ kind: 'ellipse', a: map(edge.start), b: map(edge.end), mid, rx, ry, rotation: (rotation * 180) / Math.PI, large: Math.abs(curve.sweep) > Math.PI + 1e-9, ccw: edge.ccw !== flips }];
    }
  }
}

/** An edge in (u, v) under any map: cubic pieces through the mapped points with the mapped tangents (Hermite). */
function mappedPieces(edge: ProfileEdge, uv: (p: Vec2) => Vec2): Piece[] {
  const curve = parametric(edge);
  const h = 1e-5;
  // The map's derivative along a direction, from nearby points.
  const along = (p: Vec2, d: Vec2): Vec2 => scale2(sub2(uv(add2(p, scale2(d, h))), uv(sub2(p, scale2(d, h)))), 1 / (2 * h));
  const step = curve.sweep / curve.count;
  const pieces: Piece[] = [];
  for (let i = 0; i < curve.count; i++) {
    const [t1, t2] = [curve.t0 + i * step, curve.t0 + (i + 1) * step];
    const [p1, p2] = [i === 0 ? edge.start : curve.at(t1), i === curve.count - 1 ? edge.end : curve.at(t2)];
    const [a, b] = [uv(p1), uv(p2)];
    pieces.push({ kind: 'bezier', a, c1: add2(a, scale2(along(p1, curve.tangent(t1)), step / 3)), c2: sub2(b, scale2(along(p2, curve.tangent(t2)), step / 3)), b });
  }
  return pieces;
}

/** A loop in (u, v), shifted, its pieces meeting exactly end to start. */
function mappedLoop(loop: ProfileLoop, unroll: Unrolling, shift: Vec2): Piece[] {
  const linear = unroll.linear;
  const pieces = loop.edges.flatMap((edge) => (linear ? affinePieces(edge, linear.m, linear.t) : mappedPieces(edge, unroll.uv)));
  const m = (q: Vec2) => add2(q, shift);
  const moved = pieces.map((p): Piece => (p.kind === 'line' ? { ...p, a: m(p.a), b: m(p.b) } : p.kind === 'bezier' ? { ...p, a: m(p.a), c1: m(p.c1), c2: m(p.c2), b: m(p.b) } : { ...p, a: m(p.a), b: m(p.b), mid: m(p.mid) }));
  return moved.map((p, i) => (i === 0 ? p : { ...p, a: (moved[i - 1] as Piece).b }));
}

const add2 = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const scale2 = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];

/** Twice the signed area a loop of pieces encloses (positive counter-clockwise), from its control polygon. */
function signedArea(pieces: readonly Piece[]): number {
  const points = pieces.flatMap((p) => (p.kind === 'line' ? [p.a] : p.kind === 'bezier' ? [p.a, p.c1, p.c2] : [p.a, p.mid]));
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length] as Vec2;
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
}

const reversed = (pieces: readonly Piece[]): Piece[] =>
  [...pieces].reverse().map((p): Piece => (p.kind === 'line' ? { kind: 'line', a: p.b, b: p.a } : p.kind === 'bezier' ? { kind: 'bezier', a: p.b, c1: p.c2, c2: p.c1, b: p.a } : { ...p, a: p.b, b: p.a, ccw: !p.ccw }));

/** A loop drawn counter-clockwise (outer) or clockwise (hole). */
function loopDrawingOf(pieces: readonly Piece[], counterClockwise: boolean): Drawing {
  const oriented = signedArea(pieces) > 0 === counterClockwise ? pieces : reversed(pieces);
  const start = (oriented[0] as Piece).a;
  const pen = draw([start[0], start[1]]);
  for (const [i, piece] of oriented.entries()) {
    const end = i === oriented.length - 1 ? start : piece.b;
    if (piece.kind === 'line') pen.lineTo([end[0], end[1]]);
    else if (piece.kind === 'bezier') pen.cubicBezierCurveTo([end[0], end[1]], [piece.c1[0], piece.c1[1]], [piece.c2[0], piece.c2[1]]);
    else pen.ellipseTo([end[0], end[1]], piece.rx, piece.ry, piece.rotation, piece.large, piece.ccw);
  }
  return pen.close();
}

/** The faces of the profiles lying on the surface moved `offset` along its normal, from their outlines in its (u, v). */
function wrappedFaces(profiles: readonly Profile[], unroll: Unrolling, offset: number): Face[] {
  const oc = getOC();
  const { surface, shift } = unroll.surface(offset);
  const maker = new oc.BRepBuilderAPI_MakeFace(surface as never, 1e-6);
  const support = new Face(maker.Face());
  maker.delete();
  const faces: Face[] = [];
  try {
    for (const profile of profiles) {
      const outer = mappedLoop(profile.outer, unroll, shift);
      const us = outer.flatMap((p) => [p.a[0], p.b[0]]);
      if (Math.max(...us) - Math.min(...us) > 2 * Math.PI - 1e-6) throw new WrapError('The sketch is wider than once round the face.');
      const blueprints = [loopDrawingOf(outer, true).blueprint, ...profile.holes.map((hole) => loopDrawingOf(mappedLoop(hole, unroll, shift), false).blueprint)];
      const drawing = blueprints.length > 1 ? new Drawing(new CompoundBlueprint(blueprints as never)) : new Drawing(blueprints[0] as never);
      const sketched = drawing.sketchOnFace(support, 'native') as Sketch | CompoundSketch | Sketches;
      faces.push(sketched instanceof Sketches ? (sketched.faces() as unknown as Face) : sketched.face());
    }
  } finally {
    support.delete();
  }
  return faces;
}

/** A face thickened along its normal (negative: against it) into a solid. */
function thickened(face: Face, offset: number): Shape3D {
  const oc = getOC();
  const maker = new oc.BRepOffsetAPI_MakeThickSolid();
  try {
    maker.MakeThickSolidBySimple(face.wrapped, offset);
    const shape = adopt(maker.Shape()) as Shape3D;
    const volume = measureVolume(shape);
    if (!(Math.abs(volume) > 1e-9)) throw new WrapError('The face could not be thickened by this depth. Try a smaller depth.');
    // Thickened against a face's own orientation, the solid comes out inside out.
    if (volume < 0) shape.wrapped.Reverse();
    return shape;
  } finally {
    maker.delete();
  }
}

/** The way the material faces at a point of a face (its outward normal there). */
const outwardAt = (face: Face, point: Vec3): Vec3 => normalize3(face.normalAt([...point]).toTuple() as Vec3);

/** The distance from a point to a face. */
function distanceTo(face: Face, point: Vec3): number {
  const tool = new (getOC().BRepExtrema_DistShapeShape)();
  const vertex = makeVertex([...point]);
  try {
    tool.LoadS1(face.wrapped);
    tool.LoadS2(vertex.wrapped);
    tool.Perform();
    return tool.IsDone() ? tool.Value() : Infinity;
  } finally {
    tool.delete();
    vertex.delete();
  }
}

/** The solids of a shape, apart. */
function solids(shape: Shape3D): Shape3D[] {
  const oc = getOC();
  const found: Shape3D[] = [];
  const explorer = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    for (; explorer.More(); explorer.Next()) found.push(adopt(explorer.Current()) as Shape3D);
  } finally {
    explorer.delete();
  }
  return found;
}

/**
 * The tool an emboss or engrave adds or cuts: the profiles laid onto the face (rolled onto a cylinder
 * or cone, or cast along the sketch's normal), thickened by the depth out of the face or into it. Its
 * faces are `top` (away from the face), `base` (on it) and `side` (ADR-54b).
 */
export function wrapTool(feature: string, frame: PlaneFrame, profiles: readonly Profile[], pieces: readonly Face[], method: 'wrap' | 'project', depth: number, operation: 'emboss' | 'engrave'): NamedShape {
  const face = pieces[0] as Face;
  if (profiles.length === 0) throw new WrapError('Select at least one profile.');
  if (!(depth > 0)) throw new WrapError('The depth must be more than zero.');
  const outward = operation === 'emboss' ? 1 : -1;
  // How far the tool reaches past the face, on the side where it adds or removes nothing.
  const overlap = Math.min(0.01, depth / 10);
  let shape: Shape3D;
  if (method === 'wrap' && face.geomType !== 'PLANE') {
    const unroll = unrolling(face, frame);
    // Which way the material faces along the surface's normal: out of a shaft, into a bore.
    const probe = face.pointOnSurface(0.5, 0.5).toTuple() as Vec3;
    const material = dot3(outwardAt(face, probe), unroll.normal(probe)) > 0 ? 1 : -1;
    // The tool starts a little on the other side of the face, so its face is not the body's own: booleans of touching cones fail.
    const made = wrappedFaces(profiles, unroll, -material * outward * overlap).map((wrapped) => {
      // Thickened out of the material (emboss) or into it (engrave), whichever way the new face points.
      const point = wrapped.pointOnSurface(0.5, 0.5).toTuple() as Vec3;
      const along = dot3(outwardAt(wrapped, point), unroll.normal(point)) * material > 0 ? 1 : -1;
      const solid = thickened(wrapped, along * outward * (depth + overlap));
      wrapped.delete();
      return solid;
    });
    shape = made.length === 1 ? (made[0] as Shape3D) : (makeCompound(made) as unknown as Shape3D);
  } else {
    // Cast along the sketch's normal as it is seen from its front: a prism through everything, kept
    // where it meets the face thickened by the depth, where it meets it first.
    const n = normalOf(frame);
    const box = face.boundingBox;
    const [low, high] = box.bounds as unknown as [Vec3, Vec3];
    const reach = length3(sub3(high, low)) + length3(sub3(scale3(add3(low, high), 0.5), frame.origin)) + 4 * depth + 1;
    const drawing = profilesDrawing(profiles);
    const prism = drawing.sketchOnPlane(toPlane(frame, reach)).extrude(2 * reach, { extrusionDirection: [...scale3(n, -1)] }) as Shape3D;
    // A face split in pieces (a round face of two halves) is thickened piece by piece.
    const slabs = pieces.map((piece) => {
      const base = makeOffset(piece, -outward * overlap) as unknown as Face;
      try {
        return thickened(base, outward * (depth + overlap));
      } finally {
        base.delete();
      }
    });
    const slab = slabs.length === 1 ? (slabs[0] as Shape3D) : (makeCompound(slabs) as unknown as Shape3D);
    const met = intersect(prism, slab);
    prism.delete();
    slab.delete();
    // A face that the prism passes twice (the far side of a cylinder): only the nearer side is meant.
    const parts = solids(met);
    if (parts.length === 0) throw new WrapError('The profiles do not land on the face along the sketch’s normal.');
    const height = (solid: Shape3D) => dot3(solid.boundingBox.center as unknown as Vec3, n);
    const sorted = parts.map((solid) => ({ s: solid, d: -height(solid) })).sort((a, b) => a.d - b.d);
    const gaps = sorted.slice(1).map((p, i) => p.d - (sorted[i] as { d: number }).d);
    const largest = gaps.reduce((best, gap, i) => (gap > (gaps[best] ?? 0) ? i : best), 0);
    const cutAt = gaps.length && (gaps[largest] as number) > 2 * depth + 1e-3 ? largest + 1 : sorted.length;
    const kept = sorted.slice(0, cutAt).map((p) => p.s);
    for (const p of sorted.slice(cutAt)) p.s.delete();
    shape = kept.length === 1 ? (kept[0] as Shape3D) : fuse(kept[0] as Shape3D, ...kept.slice(1));
    if (kept.length > 1) for (const k of kept) k.delete();
    met.delete();
  }
  return nameShape(
    shape,
    [],
    (toolFace) => {
      const probe = toolFace.pointOnSurface(0.5, 0.5).toTuple() as Vec3;
      const d = Math.min(...pieces.map((piece) => distanceTo(piece, probe)));
      return `f:${feature}:${Math.abs(d - overlap) < overlap / 2 ? 'base' : Math.abs(d - depth) < overlap / 2 ? 'top' : 'side'}`;
    },
    feature,
  );
}

