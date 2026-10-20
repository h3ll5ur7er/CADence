import { edgesOf, facesOf, type NamedShape, place, verticesOf } from '@core/access/shape';
import { fromFrame } from '@core/utilities/math';
import type { PlaneFrame, Vec2, Vec3 } from '@core/contracts';
import { type AnyShape, type Edge, type Face, getOC, makeBox, makeCompound, makeProjectedEdges, ProjectionCamera, type Shape3D } from 'replicad';
import { add3, cross3, dot3, normalize3, scale3, sub3 } from './geometry';
import { meshHiddenLines } from './hidden-lines';
import type { ProjectedCurve } from './modeling-engine';

/** How a drawing view sees the bodies. */
export interface ViewRequest {
  /** The view's right (`u`) and up (`v`) in model coordinates; the viewer is on the side of u × v. */
  readonly frame: PlaneFrame;
  readonly hidden: boolean;
  /** Takes away everything nearer the viewer than a plane across the view, `offset` mm from the bodies' middle towards the viewer; the cut is hatched. */
  readonly cut?: { readonly offset: number };
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

export function drawingView(bodies: readonly { readonly id: string; readonly named: NamedShape }[], request: ViewRequest, projectEdge: EdgeProjector): ViewGeometry {
  const { origin, u, v } = request.frame;
  const n = normalize3(cross3(u, v));
  const flat = (p: Vec3): Vec2 => {
    const d = sub3(p, origin);
    return [dot3(d, u), dot3(d, v)];
  };
  const owned: AnyShape[] = [];
  try {
    // A section takes away the half nearer the viewer: a box far larger than the model.
    let shapes: Shape3D[] = bodies.map((b) => b.named.shape);
    const cutFaces: (readonly [Vec2, Vec2])[] = [];
    let cutAt: Vec3 | undefined;
    if (request.cut && shapes.length) {
      // The middle of all bodies, moved towards the viewer by the offset.
      const middle = shapes.map((s) => s.boundingBox.center as Vec3).reduce((sum, c) => [sum[0] + c[0] / shapes.length, sum[1] + c[1] / shapes.length, sum[2] + c[2] / shapes.length] as Vec3, [0, 0, 0] as Vec3);
      const plane = { origin: add3(middle, scale3(n, request.cut.offset)), normal: n };
      cutAt = plane.origin;
      const size = 1e5;
      const box = makeBox([-size, -size, 0], [size, size, size]) as Shape3D;
      owned.push(box);
      // The box above z = 0, turned so its z is the cut's normal and moved to the cut's origin.
      const z = normalize3(plane.normal);
      const x = normalize3(Math.abs(z[2]) < 0.9 ? cross3([0, 0, 1], z) : cross3([1, 0, 0], z));
      const tool = place(box, fromFrame(plane.origin, x, cross3(z, x), z));
      owned.push(tool);
      shapes = shapes.map((shape) => {
        const kept = shape.cut(tool) as Shape3D;
        owned.push(kept);
        return kept;
      });
      // Faces lying on the cut plane are the cut.
      for (const shape of shapes)
        for (const face of facesOf(shape)) {
          const [c, m] = [face.center, face.normalAt()];
          const [center, normal] = [c.toTuple() as Vec3, m.toTuple() as Vec3];
          c.delete();
          m.delete();
          if (Math.abs(dot3(sub3(center, plane.origin), z)) < 1e-6 && Math.abs(Math.abs(dot3(normal, z)) - 1) < 1e-6) {
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
    const seen = seenOn(visible, tolerance);

    // Named geometry of the (uncut) bodies, to dimension, with whether the view shows it.
    const points: { name: string; at: Vec2; model?: Vec3; hidden?: true }[] = [];
    const circles: { name: string; center: Vec2; radius: number; model?: Vec3; hidden?: true }[] = [];
    const lines: { name: string; start: Vec2; end: Vec2; model?: Vec3; hidden?: true }[] = [];
    // A point is seen where it is drawn; a line or circle where a stretch of it is (two neighbouring
    // samples), not where it only touches something drawn (CAD-129).
    const shown = (samples: readonly Vec2[]) => {
      const drawn = samples.map(seen);
      return drawn.length === 1 ? drawn[0] : drawn.some((s, i) => s && drawn[i + 1]);
    };
    const flag = (samples: readonly Vec2[]) => (shown(samples) ? {} : { hidden: true as const });
    const along = (a: Vec2, b: Vec2) => Array.from({ length: 21 }, (_, i): Vec2 => [a[0] + ((b[0] - a[0]) * (i + 0.5)) / 21, a[1] + ((b[1] - a[1]) * (i + 0.5)) / 21]);
    for (const { named } of bodies) {
      for (const vertex of verticesOf(named)) {
        const at = flat(vertex.point);
        points.push({ name: vertex.name, at, model: vertex.point, ...flag([at]) });
      }
      for (const edge of edgesOf(named.shape)) {
        const name = named.edges.get(edge.hashCode);
        if (!name) continue;
        for (const curve of projectEdge(edge, flat, n)) {
          if (curve.kind === 'line' && (edge.geomType as string) === 'LINE') {
            const [s, e] = [edge.startPoint, edge.endPoint];
            lines.push({ name, start: curve.start, end: curve.end, model: scale3(add3(s.toTuple() as Vec3, e.toTuple() as Vec3), 0.5), ...flag(along(curve.start, curve.end)) });
            s.delete();
            e.delete();
          } else if (curve.kind !== 'line') {
            const radius = curve.kind === 'circle' ? curve.radius : Math.hypot(curve.start[0] - curve.center[0], curve.start[1] - curve.center[1]);
            const center = centerOf(edge);
            circles.push({ name, center: curve.center, radius, ...(center ? { model: center } : {}), ...flag(around(curve)) });
          }
        }
      }
      // Cylinders seen from the side show outlines, not edges: lines with points at their ends (CAD-127).
      for (const face of facesOf(named.shape)) {
        const name = named.faces.get(face.hashCode);
        if (!name) continue;
        outlinesOf(face, n).forEach(([a, b], k) => {
          const id = `s:${name}:${k + 1}`;
          const [start, end] = [flat(a), flat(b)];
          lines.push({ name: id, start, end, model: scale3(add3(a, b), 0.5), ...flag(along(start, end)) });
          points.push({ name: `${id}:a`, at: start, model: a, ...flag([start]) }, { name: `${id}:b`, at: end, model: b, ...flag([end]) });
        });
      }
    }
    points.push(...extremesOf(visible));
    const placed = bodies.map(({ id, named }) => ({ id, at: flat(named.shape.boundingBox.center as Vec3) }));
    return {
      visible,
      hidden,
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

/**
 * The outlines of a cylinder seen from its side: the two lines along it where its surface turns
 * away from the viewer, where they lie on the face (a part of a cylinder may have one or none).
 */
function outlinesOf(face: Face, n: Vec3): (readonly [Vec3, Vec3])[] {
  if (face.geomType !== 'CYLINDRE') return [];
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
