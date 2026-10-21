import { edgesOf, facesOf, type NamedShape, place, verticesOf } from '@core/access/shape';
import { fromFrame } from '@core/utilities/math';
import { type PlaneFrame, type SectionCut, sectionPieces, type ThreadMarker, type Vec2, type Vec3 } from '@core/contracts';
import { type AnyShape, type Edge, type Face, getOC, makeBox, makeCompound, makeProjectedEdges, ProjectionCamera, type Shape3D } from 'replicad';
import { add3, cross3, dot3, normalize3, scale3, sub3 } from './geometry';
import { meshHiddenLines } from './hidden-lines';
import { threadFilled } from './holes';
import type { ProjectedCurve } from './modeling-engine';
import { nameShape, namedSurfaces } from './naming';

/** How a drawing view sees the bodies. */
export interface ViewRequest {
  /** The view's right (`u`) and up (`v`) in model coordinates; the viewer is on the side of u × v. */
  readonly frame: PlaneFrame;
  readonly hidden: boolean;
  /**
   * Takes away everything nearer the viewer than a plane across the view, `offset` mm from the
   * bodies' middle towards the viewer; the cut is hatched. Stepped and half cuts as in a drawing's
   * `SectionCut` (CAD-164), with `at` along the frame's `u` or `v` from the bodies' middle.
   */
  readonly cut?: SectionCut;
  /** Names of the bodies' geometry prefixed with the body's id (`<id>/<name>`): the parts of an assembly (CAD-167). */
  readonly prefixed?: boolean;
  /**
   * How hidden lines are found: by the kernel, exactly (the default), or from the bodies' triangles,
   * approximately but fast on any shape (CAD-125).
   */
  readonly method?: 'exact' | 'mesh';
}

/** Model geometry in a view, to attach dimensions to: by name, where it is in the model, and whether the view shows it (CAD-127, CAD-128). */
interface Anchored {
  readonly name: string;
  /** In model millimetres: a point, a circle's centre, a line's middle. */
  readonly model?: Vec3;
  /** Behind something or cut away: not drawn unless the view shows hidden lines. */
  readonly hidden?: true;
}

/** A drawing view in the view's millimetres (u right, v up, from the frame's origin). */
export interface ViewGeometry {
  readonly visible: readonly ProjectedCurve[];
  readonly hidden: readonly ProjectedCurve[];
  /** Thin continuous lines seen: threads' minor (shafts) or major (holes) diameters, ISO 6410 (CAD-166). */
  readonly thin?: readonly ProjectedCurve[];
  /** Outlines of the faces a section cut, as segments (for hatching by crossings). */
  readonly cut: readonly (readonly [Vec2, Vec2])[];
  /**
   * Named model geometry to attach dimensions to: vertices, the outermost points seen
   * (`extreme:left`, `right`, `top`, `bottom`), and the ends of cylinders' outlines (`<outline>:a`, `:b`).
   */
  readonly points: readonly (Anchored & { readonly at: Vec2 })[];
  readonly circles: readonly (Anchored & { readonly center: Vec2; readonly radius: number })[];
  /** Straight edges, and the outlines of cylinders seen from the side (`s:<face>:1`, `s:<face>:2`). */
  readonly lines: readonly (Anchored & { readonly start: Vec2; readonly end: Vec2 })[];
  /** Where each body is (the middle of its box), for balloons. */
  readonly bodies: readonly { readonly id: string; readonly at: Vec2 }[];
  readonly box: { readonly min: Vec2; readonly max: Vec2 };
  /** A point of a section's plane, in model millimetres: where its cutting-plane line goes on other views. */
  readonly cutAt?: Vec3;
  /** Drawn from the triangles, not exactly (`method: 'mesh'`). */
  readonly approximate?: true;
}

/** An edge as lines, circles and arcs, through `flat`; circles stay circles when they face the viewer. */
export type EdgeProjector = (edge: Edge, flat: (p: Vec3) => Vec2, normal: Vec3) => ProjectedCurve[];

export function drawingView(given: readonly { readonly id: string; readonly named: NamedShape }[], request: ViewRequest, projectEdge: EdgeProjector): ViewGeometry {
  const { origin, u, v } = request.frame;
  const n = normalize3(cross3(u, v));
  const flat = (p: Vec3): Vec2 => {
    const d = sub3(p, origin);
    return [dot3(d, u), dot3(d, v)];
  };
  const owned: AnyShape[] = [];
  try {
    // Modelled threads are drawn as threads are (ISO 6410), from the body with their groove filled:
    // the kernel takes minutes over a helix (CAD-166).
    const bodies = given.map((body) => {
      const modelled = (body.named.threads ?? []).filter((t) => t.modelled);
      if (!modelled.length) return body;
      try {
        let shape = body.named.shape;
        for (const thread of modelled) {
          const next = threadFilled(shape, thread, (thread.modelled as { faceLength: number }).faceLength);
          if (shape !== body.named.shape) shape.delete();
          shape = next;
        }
        owned.push(shape);
        const named = nameShape(shape, namedSurfaces(body.named), () => undefined, 'drawing');
        return { id: body.id, named: { ...named, threads: body.named.threads ?? [] } };
      } catch {
        // A groove that cannot be filled is drawn as it is.
        return body;
      }
    });
    let shapes: Shape3D[] = bodies.map((b) => b.named.shape);
    const cutFaces: (readonly [Vec2, Vec2])[] = [];
    let cutAt: Vec3 | undefined;
    /** Where a stepped or half cut turns, across the view (CAD-164): their edges are not drawn. */
    let turns: { readonly axis: 0 | 1; readonly at: number }[] = [];
    /** Whether a point of the model is in what the cut takes away. */
    let removed = (_p: Vec3) => false;
    if (request.cut && shapes.length) {
      // The middle of all bodies; each piece of the cut a plane moved towards the viewer by its offset.
      const middle = shapes.map((s) => s.boundingBox.center as Vec3).reduce((sum, c) => [sum[0] + c[0] / shapes.length, sum[1] + c[1] / shapes.length, sum[2] + c[2] / shapes.length] as Vec3, [0, 0, 0] as Vec3);
      const pieces = sectionPieces(request.cut);
      const axis = request.cut.along === 'v' ? 1 : 0;
      const w = axis ? v : u;
      cutAt = add3(middle, scale3(n, request.cut.offset));
      const size = 1e5;
      for (const piece of pieces) {
        // A box from the piece's plane towards the viewer, across its stretch of the view: its x along
        // the steps, its z the cut's normal, placed at the bodies' middle.
        const [from, to] = [Math.max(-size, piece.from), Math.min(size, piece.to)];
        const box = makeBox([from, -size, piece.offset], [to, size, size]) as Shape3D;
        owned.push(box);
        const tool = place(box, fromFrame(middle, w, cross3(n, w), n));
        owned.push(tool);
        shapes = shapes.map((shape) => {
          const kept = shape.cut(tool) as Shape3D;
          owned.push(kept);
          return kept;
        });
      }
      const across = (p: Vec3) => dot3(sub3(p, middle), w);
      const deep = (p: Vec3) => dot3(sub3(p, middle), n);
      removed = (p) => pieces.some((piece) => across(p) >= piece.from - 1e-9 && across(p) <= piece.to + 1e-9 && deep(p) >= piece.offset - 1e-9);
      turns = pieces.flatMap((piece, i) => {
        const before = pieces[i - 1];
        const turning = request.cut?.half || (before !== undefined && before.to === piece.from && before.offset !== piece.offset);
        return Number.isFinite(piece.from) && turning ? [{ axis, at: flat(middle)[axis] + piece.from }] : [];
      });
      // Faces lying on a piece's plane, within its stretch, are the cut.
      for (const shape of shapes)
        for (const face of facesOf(shape)) {
          const [c, m] = [face.center, face.normalAt()];
          const [center, normal] = [c.toTuple() as Vec3, m.toTuple() as Vec3];
          c.delete();
          m.delete();
          const on = pieces.some((piece) => Math.abs(deep(center) - piece.offset) < 1e-6 && across(center) > piece.from - 1e-6 && across(center) < piece.to + 1e-6);
          if (on && Math.abs(Math.abs(dot3(normal, n)) - 1) < 1e-6) {
            for (const edge of face.edges) for (const curve of projectEdge(edge, flat, n)) cutFaces.push(...segmentsOf(curve));
          }
        }
    }
    let visible: ProjectedCurve[];
    let hidden: ProjectedCurve[];
    let tolerance: number;
    if (request.method === 'mesh') {
      ({ visible, hidden, tolerance } = meshHiddenLines(shapes, { origin, u, v, n }, (edge) => projectEdge(edge, flat, n), (face) => outlinesOf(face, n)));
    } else {
      // makeCompound frees what it is given: clones, so the bodies and cut shapes stay.
      const compound = makeCompound(shapes.map((shape) => shape.clone()));
      owned.push(compound);
      const camera = new ProjectionCamera([...origin], [...n], [...u]);
      const projected = makeProjectedEdges(compound, camera, request.hidden);
      camera.delete();
      // The projection's edges lie in the camera's plane, in its coordinates.
      const plain = (p: Vec3): Vec2 => [p[0], p[1]];
      const curves = (edges: Edge[]) => edges.flatMap((e) => projectEdge(e, plain, [0, 0, 1]));
      visible = curves(projected.visible);
      // Hidden edges right under visible ones (the bottom of a hole seen from above) are not drawn.
      hidden = curves(projected.hidden).filter((curve) => !visible.some((shown) => covers(shown, curve)));
      for (const e of [...projected.visible, ...projected.hidden]) e.delete();
      const box = boxOf(visible);
      tolerance = Math.max(1e-4, 1e-5 * Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1]));
    }
    // Where a stepped cut turns, the step's edges lie across the hatching: not drawn (CAD-164).
    if (turns.length) visible = visible.filter((curve) => !turns.some((turn) => acrossTurn(curve, turn, cutFaces)));
    const seen = seenOn(visible, tolerance);

    // Named geometry of the (uncut) bodies, to dimension, with whether the view shows it.
    const points: { name: string; at: Vec2; model?: Vec3; hidden?: true }[] = [];
    const circles: { name: string; center: Vec2; radius: number; model?: Vec3; hidden?: true }[] = [];
    const lines: { name: string; start: Vec2; end: Vec2; model?: Vec3; hidden?: true }[] = [];
    // A point is seen where it is drawn; a line or circle where a stretch of it is (two neighbouring
    // samples), not where it only touches something drawn (CAD-129).
    const shown = (samples: readonly Vec2[], test = seen) => {
      const drawn = samples.map(test);
      return drawn.length === 1 ? drawn[0] : drawn.some((s, i) => s && drawn[i + 1]);
    };
    const flag = (samples: readonly Vec2[], test = seen) => (shown(samples, test) ? {} : { hidden: true as const });
    const along = (a: Vec2, b: Vec2) => Array.from({ length: 21 }, (_, i): Vec2 => [a[0] + ((b[0] - a[0]) * (i + 0.5)) / 21, a[1] + ((b[1] - a[1]) * (i + 0.5)) / 21]);
    const ring = (center: Vec2, radius: number) => Array.from({ length: 48 }, (_, i): Vec2 => [center[0] + radius * Math.cos((i * Math.PI) / 24), center[1] + radius * Math.sin((i * Math.PI) / 24)]);
    // Outlines found from the triangles lie near the edges drawn, not on them.
    let near: ((p: Vec2) => boolean) | undefined;
    for (const { id, named } of bodies) {
      const own = (name: string) => (request.prefixed ? `${id}/${name}` : name);
      for (const vertex of verticesOf(named)) {
        const at = flat(vertex.point);
        points.push({ name: own(vertex.name), at, model: vertex.point, ...flag([at]) });
      }
      for (const edge of edgesOf(named.shape)) {
        const name = named.edges.get(edge.hashCode);
        if (!name) continue;
        for (const curve of projectEdge(edge, flat, n)) {
          if (curve.kind === 'line' && (edge.geomType as string) === 'LINE') {
            const [s, e] = [edge.startPoint, edge.endPoint];
            lines.push({ name: own(name), start: curve.start, end: curve.end, model: scale3(add3(s.toTuple() as Vec3, e.toTuple() as Vec3), 0.5), ...flag(along(curve.start, curve.end)) });
            s.delete();
            e.delete();
          } else if (curve.kind !== 'line') {
            const radius = curve.kind === 'circle' ? curve.radius : Math.hypot(curve.start[0] - curve.center[0], curve.start[1] - curve.center[1]);
            const center = centerOf(edge);
            circles.push({ name: own(name), center: curve.center, radius, ...(center ? { model: center } : {}), ...flag(around(curve)) });
          }
        }
      }
      // Round faces show outlines, not edges (CAD-127, CAD-167): cylinders and cones seen from the side
      // lines with points at their ends; spheres, and tori seen along their axis, circles; other round
      // faces the outermost points of their outline.
      for (const face of facesOf(named.shape)) {
        const name = named.faces.get(face.hashCode);
        if (!name) continue;
        outlinesOf(face, n).forEach(([a, b], k) => {
          const line = own(`s:${name}:${k + 1}`);
          const [start, end] = [flat(a), flat(b)];
          lines.push({ name: line, start, end, model: scale3(add3(a, b), 0.5), ...flag(along(start, end)) });
          points.push({ name: `${line}:a`, at: start, model: a, ...flag([start]) }, { name: `${line}:b`, at: end, model: b, ...flag([end]) });
        });
        for (const circle of roundOutlinesOf(face, n)) {
          const center = flat(circle.center);
          const samples = circle.on.length ? circle.on.map(flat) : ring(center, circle.radius);
          circles.push({ name: own(`s:${name}${circle.suffix}`), center, radius: circle.radius, model: circle.center, ...flag(samples) });
        }
        if (isFreeForm(face)) {
          const outline = outlineExtremes(face, n, flat);
          const [low, high] = named.shape.boundingBox.bounds as [Vec3, Vec3];
          if (outline.length) near ??= seenOn(visible, Math.max(tolerance, 0.002 * Math.hypot(...sub3(high, low))));
          for (const extreme of outline) points.push({ name: own(`s:${name}:${extreme.side}`), at: extreme.at, model: extreme.model, ...flag([extreme.at], near) });
        }
      }
    }
    // Threads as ISO 6410 draws them, and their anchors (CAD-166).
    const thin: ProjectedCurve[] = [];
    for (const { id, named } of bodies)
      for (const thread of named.threads ?? []) {
        // A thread the cut takes away entirely is not drawn.
        if (request.cut && threadRing(thread).every(removed)) continue;
        const drawn = threadLines(thread, n, flat, seen);
        const own = (name: string) => (request.prefixed ? `${id}/${name}` : name);
        thin.push(...drawn.thin);
        visible.push(...drawn.visible);
        hidden.push(...drawn.hidden);
        circles.push(...drawn.circles.map((c) => ({ ...c, name: own(c.name) })));
        lines.push(...drawn.lines.map((l) => ({ ...l, name: own(l.name) })));
      }
    points.push(...extremesOf(visible));
    const placed = bodies.map(({ id, named }) => ({ id, at: flat(named.shape.boundingBox.center as Vec3) }));
    return {
      visible,
      hidden,
      ...(thin.length ? { thin } : {}),
      cut: cutFaces,
      points,
      circles,
      lines,
      bodies: placed,
      box: boxOf([...visible, ...hidden]),
      ...(cutAt ? { cutAt } : {}),
      ...(request.method === 'mesh' ? { approximate: true as const } : {}),
    };
  } finally {
    for (const shape of owned) shape.delete();
  }
}

/** Whether a straight curve lies along a turn of the cut, inside the hatched cut: a step's edge, not drawn. */
function acrossTurn(curve: ProjectedCurve, turn: { readonly axis: 0 | 1; readonly at: number }, cut: readonly (readonly [Vec2, Vec2])[]): boolean {
  if (curve.kind !== 'line' || Math.abs(curve.start[turn.axis] - turn.at) > 1e-6 || Math.abs(curve.end[turn.axis] - turn.at) > 1e-6) return false;
  const middle: Vec2 = [(curve.start[0] + curve.end[0]) / 2, (curve.start[1] + curve.end[1]) / 2];
  const beside = (by: number): Vec2 => (turn.axis === 0 ? [middle[0] + by, middle[1]] : [middle[0], middle[1] + by]);
  return insideCut(beside(1e-3), cut) || insideCut(beside(-1e-3), cut);
}

/** Whether a point lies inside the cut's outlines (even-odd crossings of a ray to the right). */
function insideCut(p: Vec2, segments: readonly (readonly [Vec2, Vec2])[]): boolean {
  let inside = false;
  for (const [a, b] of segments) {
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < a[0] + ((p[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0])) inside = !inside;
  }
  return inside;
}

interface Xyz {
  X(): number;
  Y(): number;
  Z(): number;
}
interface Ax3 {
  Location(): Xyz;
  Direction(): Xyz;
  XDirection(): Xyz;
  YDirection(): Xyz;
}
const tuple = (p: Xyz): Vec3 => [p.X(), p.Y(), p.Z()];

/**
 * The outlines of a cylinder or cone seen from its side: the lines along it where its surface turns
 * away from the viewer, where they lie on the face (a part of one may have one or none), CAD-167.
 */
function outlinesOf(face: Face, n: Vec3): (readonly [Vec3, Vec3])[] {
  if (face.geomType === 'CONE') return coneOutlines(face, n);
  if (face.geomType !== 'CYLINDRE') return [];
  const surface = new (getOC().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    const cylinder = surface.Cylinder() as unknown as { Position(): Ax3; Radius(): number };
    const position = cylinder.Position();
    const [location, axis, x, y] = [tuple(position.Location()), tuple(position.Direction()), tuple(position.XDirection()), tuple(position.YDirection())];
    const across = cross3(n, axis);
    // Seen along its axis it shows circles instead.
    if (Math.hypot(...across) < 1e-6) return [];
    const side = normalize3(across);
    const { uMin, uMax, vMin, vMax } = face.UVBounds;
    return [side, scale3(side, -1)].flatMap((w) => {
      // The angle round the axis where the outline is, inside the face's range of angles: on its
      // border there is an edge already (between two half cylinders, or the seam).
      const turn = 2 * Math.PI;
      const angle = uMin + ((((Math.atan2(dot3(w, y), dot3(w, x)) - uMin) % turn) + turn) % turn);
      if (angle < uMin + 1e-6 || angle > uMax - 1e-6) return [];
      const at = (t: number) => add3(add3(location, scale3(axis, t)), scale3(w, cylinder.Radius()));
      return [[at(vMin), at(vMax)] as const];
    });
  } finally {
    surface.delete();
  }
}

/**
 * The outlines of a cone seen from its side (CAD-167): the straight lines along it (constant u) where
 * its normal turns across the viewing direction, found by sampling round it (the kernel's cone type
 * is not bound in WebAssembly).
 */
function coneOutlines(face: Face, n: Vec3): (readonly [Vec3, Vec3])[] {
  const oc = getOC();
  const { uMin, uMax, vMin, vMax } = face.UVBounds;
  const surface = new oc.BRepAdaptor_Surface(face.wrapped, false);
  const props = new oc.BRepGProp_Face(face.wrapped, false);
  const [p, m] = [new oc.gp_Pnt(), new oc.gp_Vec()];
  try {
    const middle = (vMin + vMax) / 2;
    const facing = (u: number) => {
      props.Normal(u, middle, p, m);
      return (m.X() * n[0] + m.Y() * n[1] + m.Z() * n[2]) / (m.Magnitude() || 1);
    };
    const at = (u: number, v: number): Vec3 => {
      surface.D0(u, v, p);
      return [p.X(), p.Y(), p.Z()];
    };
    const roots: number[] = [];
    const steps = 96;
    let [a, fa] = [uMin, facing(uMin)];
    for (let k = 1; k <= steps; k++) {
      const b = uMin + ((uMax - uMin) * k) / steps;
      const fb = facing(b);
      if (fa * fb < 0) {
        let [lo, hi, flo] = [a, b, fa];
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          const fm = facing(mid);
          if (fm * flo <= 0) hi = mid;
          else [lo, flo] = [mid, fm];
        }
        roots.push((lo + hi) / 2);
      }
      [a, fa] = [b, fb];
    }
    // On the face's border there is an edge already (the seam).
    return roots.filter((u) => u > uMin + 1e-6 && u < uMax - 1e-6).map((u) => [at(u, vMin), at(u, vMax)] as const);
  } finally {
    surface.delete();
    props.delete();
    p.delete();
    m.delete();
  }
}

/**
 * Circles a round face shows as its outline (CAD-167): a sphere's silhouette where it lies on the
 * face (`on`: the points of it that do, none when all do), and a whole torus seen along its axis,
 * its outer and inner rim.
 */
function roundOutlinesOf(face: Face, n: Vec3): { suffix: string; center: Vec3; radius: number; on: Vec3[] }[] {
  if (face.geomType !== 'SPHERE' && face.geomType !== 'TORUS') return [];
  const surface = new (getOC().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    const { uMin, uMax, vMin, vMax } = face.UVBounds;
    const within = (value: number, from: number, to: number) => {
      const turn = 2 * Math.PI;
      return from + ((((value - from) % turn) + turn) % turn) <= to + 1e-9;
    };
    if (face.geomType === 'SPHERE') {
      const sphere = surface.Sphere() as unknown as { Position(): Ax3; Radius(): number };
      const position = sphere.Position();
      const [center, axis, x, y] = [tuple(position.Location()), tuple(position.Direction()), tuple(position.XDirection()), tuple(position.YDirection())];
      const radius = sphere.Radius();
      // The silhouette: the great circle across the viewing direction.
      const e1 = normalize3(Math.abs(n[2]) < 0.9 ? cross3([0, 0, 1], n) : cross3([1, 0, 0], n));
      const e2 = cross3(n, e1);
      const circle = Array.from({ length: 48 }, (_, i) => add3(center, add3(scale3(e1, radius * Math.cos((i * Math.PI) / 24)), scale3(e2, radius * Math.sin((i * Math.PI) / 24)))));
      const on = circle.filter((p) => {
        // OCCT's sphere: P(u, v) = centre + R cos v (cos u x + sin u y) + R sin v axis.
        const d = sub3(p, center);
        const latitude = Math.asin(Math.max(-1, Math.min(1, dot3(d, axis) / radius)));
        return latitude >= vMin - 1e-9 && latitude <= vMax + 1e-9 && within(Math.atan2(dot3(d, y), dot3(d, x)), uMin, uMax);
      });
      return on.length >= 2 ? [{ suffix: '', center, radius, on: on.length === circle.length ? [] : on }] : [];
    }
    // OCCT's torus: P(u, v) = centre + (R + r cos v)(cos u x + sin u y) + r sin v axis; its rims seen
    // along the axis are the circles v = 0 (outer) and v = π (inner), found from points on them (the
    // kernel's torus type is not bound in WebAssembly).
    if (uMax - uMin < 2 * Math.PI - 1e-6) return [];
    const p = new (getOC().gp_Pnt)();
    try {
      const at = (u: number, w: number): Vec3 => {
        surface.D0(u, w, p);
        return [p.X(), p.Y(), p.Z()];
      };
      return [
        ['outer', 0],
        ['inner', Math.PI],
      ].flatMap(([suffix, w]) => {
        if (!within(w as number, vMin, vMax)) return [];
        const circle = circleThrough(at(uMin, w as number), at(uMin + (2 * Math.PI) / 3, w as number), at(uMin + (4 * Math.PI) / 3, w as number));
        return circle && circle.radius > 1e-6 && Math.abs(Math.abs(dot3(circle.axis, n)) - 1) < 1e-6 ? [{ suffix: `:${suffix as string}`, center: circle.center, radius: circle.radius, on: [] }] : [];
      });
    } finally {
      p.delete();
    }
  } finally {
    surface.delete();
  }
}

/** The circle through three points: its centre, radius and the normal of its plane. */
function circleThrough(a: Vec3, b: Vec3, c: Vec3): { center: Vec3; radius: number; axis: Vec3 } | undefined {
  const [ab, ac] = [sub3(b, a), sub3(c, a)];
  const normal = cross3(ab, ac);
  const area = dot3(normal, normal);
  if (area < 1e-18) return undefined;
  // a + (|ac|² (n × ab) + |ab|² (ac × n)) / 2|n|²
  const center = add3(a, scale3(add3(scale3(cross3(normal, ab), dot3(ac, ac)), scale3(cross3(ac, normal), dot3(ab, ab))), 1 / (2 * area)));
  return { center, radius: Math.hypot(...sub3(a, center)), axis: normalize3(normal) };
}

/** Round faces whose outline has no exact form here: free-form faces, tori. */
const isFreeForm = (face: Face) => !['PLANE', 'CYLINDRE', 'CONE', 'SPHERE'].includes(face.geomType);

/**
 * The outermost points of a round face's outline (CAD-167), from its triangles: where they turn from
 * facing the viewer to facing away.
 */
function outlineExtremes(face: Face, n: Vec3, flat: (p: Vec3) => Vec2): { side: 'left' | 'right' | 'top' | 'bottom'; at: Vec2; model: Vec3 }[] {
  const box = face.boundingBox;
  const mesh = face.mesh({ tolerance: Math.max(0.005, Math.hypot(box.width, box.height, box.depth) / 500), angularTolerance: 0.1 });
  if (!mesh.triangles.length) return [];
  const at = (i: number): Vec3 => [mesh.vertices[3 * i] as number, mesh.vertices[3 * i + 1] as number, mesh.vertices[3 * i + 2] as number];
  const facing = (t: number) => {
    const [a, b, c] = [at(mesh.triangles[t] as number), at(mesh.triangles[t + 1] as number), at(mesh.triangles[t + 2] as number)];
    return dot3(cross3(sub3(b, a), sub3(c, a)), n) > 0;
  };
  const sides = new Map<string, boolean[]>();
  for (let t = 0; t < mesh.triangles.length; t += 3)
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      const [a, b] = [mesh.triangles[t + i] as number, mesh.triangles[t + j] as number];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      sides.set(key, [...(sides.get(key) ?? []), facing(t)]);
    }
  const outline = [...new Set([...sides].filter(([, list]) => list.length === 2 && list[0] !== list[1]).flatMap(([key]) => key.split(',').map(Number)))].map(at);
  if (!outline.length) return [];
  const pick = (score: (p: Vec2) => number) => outline.reduce((best, p) => (score(flat(p)) > score(flat(best)) + 1e-9 ? p : best));
  const extremes = { left: pick((p) => -p[0]), right: pick((p) => p[0]), top: pick((p) => p[1]), bottom: pick((p) => -p[1]) };
  return (Object.keys(extremes) as (keyof typeof extremes)[]).map((side) => ({ side, at: flat(extremes[side]), model: extremes[side] }));
}

/**
 * A thread as ISO 6410 draws it (CAD-166): seen from the side, its minor diameter (a shaft) or major
 * diameter (a hole) as thin lines along its length and a thick line across where it ends; seen along
 * its axis, a thin three-quarter circle open at the top right. Seen where the face it is on is seen,
 * else hidden. Anchors: the thread's circle (`thread:<feature>`, its nominal diameter) seen along the
 * axis, its thin lines (`thread:<feature>:1`, `:2`) from the side.
 */
export function threadLines(thread: ThreadMarker, n: Vec3, flat: (p: Vec3) => Vec2, seen: (p: Vec2) => boolean): ThreadLines {
  const { origin, direction: axis, radius, length, diameter, pitch, internal } = thread;
  // A shaft's minor diameter is d − 1.2269 P (d3); a hole's thin line is its major diameter.
  const fine = internal ? diameter / 2 : diameter / 2 - 0.6134 * pitch;
  const coarse = internal ? radius : Math.max(radius, fine);
  const name = `thread:${thread.feature}`;
  const result: ThreadLines = { thin: [], visible: [], hidden: [], circles: [], lines: [] };
  const stretch = (samples: readonly Vec2[]) => samples.some((p, i) => seen(p) && i + 1 < samples.length && seen(samples[i + 1] as Vec2));
  if (Math.abs(dot3(axis, n)) > 1 - 1e-6) {
    const center = flat(origin);
    const rim = Array.from({ length: 48 }, (_, i): Vec2 => [center[0] + coarse * Math.cos((i * Math.PI) / 24), center[1] + coarse * Math.sin((i * Math.PI) / 24)]);
    const shows = stretch(rim);
    // Counter-clockwise from the top round to the right: open at the top right.
    const arc: ProjectedCurve = { kind: 'arc', center, start: [center[0], center[1] + fine], end: [center[0] + fine, center[1]] };
    (shows ? result.thin : result.hidden).push(arc);
    result.circles.push({ name, center, radius: diameter / 2, model: origin, ...(shows ? {} : { hidden: true as const }) });
    return result;
  }
  // Across the axis in the view, so the lines lie where the face's outlines are.
  const side = normalize3(cross3(n, axis));
  const end = add3(origin, scale3(axis, length));
  const at = (p: Vec3, by: number) => flat(add3(p, scale3(side, by)));
  const shows = [1, -1].some((s) => stretch(Array.from({ length: 21 }, (_, i) => at(add3(origin, scale3(axis, (length * (i + 0.5)) / 21)), s * coarse))));
  [1, -1].forEach((s, k) => {
    const line: ProjectedCurve = { kind: 'line', start: at(origin, s * fine), end: at(end, s * fine) };
    (shows ? result.thin : result.hidden).push(line);
    result.lines.push({ name: `${name}:${k + 1}`, start: line.start, end: line.end, model: add3(scale3(add3(origin, end), 0.5), scale3(side, s * fine)), ...(shows ? {} : { hidden: true as const }) });
  });
  const reach = internal ? diameter / 2 : coarse;
  (shows ? result.visible : result.hidden).push({ kind: 'line', start: at(end, -reach), end: at(end, reach) });
  return result;
}

/** Points round a thread's face at its ends and middle, to tell whether a cut takes it away. */
function threadRing(thread: ThreadMarker): Vec3[] {
  const { origin, direction, length } = thread;
  const radius = Math.max(thread.radius, thread.diameter / 2);
  const x = normalize3(Math.abs(direction[2]) < 0.9 ? cross3([0, 0, 1], direction) : cross3([1, 0, 0], direction));
  const y = cross3(direction, x);
  return [0, 0.5, 1].flatMap((t) =>
    Array.from({ length: 8 }, (_, k) => add3(add3(origin, scale3(direction, t * length)), add3(scale3(x, radius * Math.cos((k * Math.PI) / 4)), scale3(y, radius * Math.sin((k * Math.PI) / 4))))),
  );
}

interface ThreadLines {

  readonly thin: ProjectedCurve[];
  readonly visible: ProjectedCurve[];
  readonly hidden: ProjectedCurve[];
  readonly circles: { name: string; center: Vec2; radius: number; model: Vec3; hidden?: true }[];
  readonly lines: { name: string; start: Vec2; end: Vec2; model: Vec3; hidden?: true }[];
}

/** A circular edge's centre in the model. */
function centerOf(edge: Edge): Vec3 | undefined {
  if (edge.geomType !== 'CIRCLE') return undefined;
  const curve = new (getOC().BRepAdaptor_Curve)(edge.wrapped);
  try {
    const p = curve.Circle().Location();
    return [p.X(), p.Y(), p.Z()];
  } finally {
    curve.delete();
  }
}

/** Points round a circle (or along an arc, end to end), 48 a turn, to tell whether a stretch of it is seen. */
function around(curve: Exclude<ProjectedCurve, { kind: 'line' }>): Vec2[] {
  const segments = segmentsOf(curve);
  return [...segments.map(([a]) => a), (segments.at(-1) as readonly [Vec2, Vec2])[1]];
}

/** The outermost points seen, for overall dimensions, also of assemblies, whose placed parts have no names (CAD-127). */
function extremesOf(visible: readonly ProjectedCurve[]): { name: string; at: Vec2 }[] {
  const all = visible.flatMap((curve) => segmentsOf(curve).flatMap(([a, b]) => [a, b]));
  if (!all.length) return [];
  const pick = (better: (p: Vec2, q: Vec2) => boolean) => all.reduce((best, p) => (better(p, best) ? p : best));
  return [
    { name: 'extreme:left', at: pick((p, q) => p[0] < q[0] - 1e-9) },
    { name: 'extreme:right', at: pick((p, q) => p[0] > q[0] + 1e-9) },
    { name: 'extreme:bottom', at: pick((p, q) => p[1] < q[1] - 1e-9) },
    { name: 'extreme:top', at: pick((p, q) => p[1] > q[1] + 1e-9) },
  ];
}

/**
 * Whether points of the view lie on its visible curves, within `tolerance`: to tell which named
 * geometry the view shows. A grid of the curves' boxes keeps it quick on views with many curves.
 */
function seenOn(curves: readonly ProjectedCurve[], tolerance: number): (p: Vec2) => boolean {
  const box = boxOf(curves);
  const cells = 64;
  const size: Vec2 = [Math.max(1e-9, (box.max[0] - box.min[0]) / cells), Math.max(1e-9, (box.max[1] - box.min[1]) / cells)];
  const cell = (x: number, axis: 0 | 1) => Math.min(cells - 1, Math.max(0, Math.floor((x - box.min[axis]) / size[axis])));
  const grid = new Map<number, ProjectedCurve[]>();
  for (const curve of curves) {
    const r = curve.kind === 'line' ? 0 : curve.kind === 'circle' ? curve.radius : Math.hypot(curve.start[0] - curve.center[0], curve.start[1] - curve.center[1]);
    const [lo, hi]: [Vec2, Vec2] =
      curve.kind === 'line'
        ? [[Math.min(curve.start[0], curve.end[0]), Math.min(curve.start[1], curve.end[1])], [Math.max(curve.start[0], curve.end[0]), Math.max(curve.start[1], curve.end[1])]]
        : [[curve.center[0] - r, curve.center[1] - r], [curve.center[0] + r, curve.center[1] + r]];
    for (let i = cell(lo[0] - tolerance, 0); i <= cell(hi[0] + tolerance, 0); i++)
      for (let j = cell(lo[1] - tolerance, 1); j <= cell(hi[1] + tolerance, 1); j++) {
        const list = grid.get(i * cells + j) ?? [];
        list.push(curve);
        grid.set(i * cells + j, list);
      }
  }
  return (p) => (grid.get(cell(p[0], 0) * cells + cell(p[1], 1)) ?? []).some((curve) => distanceTo(curve, p) <= tolerance);
}

function distanceTo(curve: ProjectedCurve, p: Vec2): number {
  if (curve.kind === 'line') {
    const d: Vec2 = [curve.end[0] - curve.start[0], curve.end[1] - curve.start[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - curve.start[0]) * d[0] + (p[1] - curve.start[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1)));
    return Math.hypot(p[0] - curve.start[0] - d[0] * t, p[1] - curve.start[1] - d[1] * t);
  }
  const radius = curve.kind === 'circle' ? curve.radius : Math.hypot(curve.start[0] - curve.center[0], curve.start[1] - curve.center[1]);
  const off = Math.abs(Math.hypot(p[0] - curve.center[0], p[1] - curve.center[1]) - radius);
  if (curve.kind === 'circle') return off;
  // On an arc: counter-clockwise from its start to its end; else as far as its nearer end.
  const angle = (q: Vec2) => Math.atan2(q[1] - curve.center[1], q[0] - curve.center[0]);
  const ccw = (a: number, b: number) => (((b - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (ccw(angle(curve.start), angle(p)) <= ccw(angle(curve.start), angle(curve.end))) return off;
  return Math.min(Math.hypot(p[0] - curve.start[0], p[1] - curve.start[1]), Math.hypot(p[0] - curve.end[0], p[1] - curve.end[1]));
}

/** Whether `shown` lies over all of `other`: the same circle, or a line along it from end to end. */
function covers(shown: ProjectedCurve, other: ProjectedCurve): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (shown.kind !== 'line' && other.kind !== 'line') {
    const radius = (c: Exclude<ProjectedCurve, { kind: 'line' }>) => (c.kind === 'circle' ? c.radius : Math.hypot(c.start[0] - c.center[0], c.start[1] - c.center[1]));
    const same = (p: Vec2, q: Vec2) => near(p[0], q[0]) && near(p[1], q[1]);
    const circle = near(shown.center[0], other.center[0]) && near(shown.center[1], other.center[1]) && near(radius(shown), radius(other));
    if (!circle || shown.kind === 'circle') return circle;
    // Two arcs of one circle: the same piece of it.
    return other.kind === 'arc' && ((same(shown.start, other.start) && same(shown.end, other.end)) || (same(shown.start, other.end) && same(shown.end, other.start)));
  }
  if (shown.kind !== 'line' || other.kind !== 'line') return false;
  const [d0, d1] = [shown.end[0] - shown.start[0], shown.end[1] - shown.start[1]];
  const length = Math.hypot(d0, d1);
  if (length < 1e-9) return false;
  // Both ends of the other line on this one: no distance across it, and within its length.
  return [other.start, other.end].every((p) => {
    const [x, y] = [p[0] - shown.start[0], p[1] - shown.start[1]];
    const along = (x * d0 + y * d1) / length;
    return Math.abs(x * d1 - y * d0) / length < 1e-6 && along > -1e-6 && along < length + 1e-6;
  });
}

/** A curve as straight segments (circles and arcs in 48 steps a turn). */
export function segmentsOf(curve: ProjectedCurve): (readonly [Vec2, Vec2])[] {
  if (curve.kind === 'line') return [[curve.start, curve.end]];
  const radius = curve.kind === 'circle' ? curve.radius : Math.hypot(curve.start[0] - curve.center[0], curve.start[1] - curve.center[1]);
  const from = curve.kind === 'circle' ? 0 : Math.atan2(curve.start[1] - curve.center[1], curve.start[0] - curve.center[0]);
  const to = curve.kind === 'circle' ? 2 * Math.PI : Math.atan2(curve.end[1] - curve.center[1], curve.end[0] - curve.center[0]);
  const sweep = curve.kind === 'circle' ? 2 * Math.PI : (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
  const steps = Math.max(2, Math.ceil((sweep / (2 * Math.PI)) * 48));
  const at = (k: number): Vec2 => [curve.center[0] + radius * Math.cos(from + (sweep * k) / steps), curve.center[1] + radius * Math.sin(from + (sweep * k) / steps)];
  return Array.from({ length: steps }, (_, k) => [at(k), at(k + 1)] as const);
}

function boxOf(curves: readonly ProjectedCurve[]): { min: Vec2; max: Vec2 } {
  const [min, max] = [[Infinity, Infinity], [-Infinity, -Infinity]];
  for (const curve of curves)
    for (const [a, b] of segmentsOf(curve))
      for (const p of [a, b]) {
        min[0] = Math.min(min[0] as number, p[0]);
        min[1] = Math.min(min[1] as number, p[1]);
        max[0] = Math.max(max[0] as number, p[0]);
        max[1] = Math.max(max[1] as number, p[1]);
      }
  return Number.isFinite(min[0]) ? { min: [min[0] as number, min[1] as number], max: [max[0] as number, max[1] as number] } : { min: [0, 0], max: [0, 0] };
}
