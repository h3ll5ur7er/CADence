import { edgesOf, facesOf, type NamedShape, place, verticesOf } from '@core/access/shape';
import { fromFrame } from '@core/utilities/math';
import type { PlaneFrame, Vec2, Vec3 } from '@core/contracts';
import { type AnyShape, type Edge, makeBox, makeCompound, makeProjectedEdges, ProjectionCamera, type Shape3D } from 'replicad';
import { cross3, dot3, normalize3, sub3 } from './geometry';
import type { ProjectedCurve } from './modeling-engine';

/** How a drawing view sees the bodies. */
export interface ViewRequest {
  /** The view's right (`u`) and up (`v`) in model coordinates; the viewer is on the side of u × v. */
  readonly frame: PlaneFrame;
  readonly hidden: boolean;
  /** Takes away everything nearer the viewer than a plane across the view, `offset` mm from the bodies' middle towards the viewer; the cut is hatched. */
  readonly cut?: { readonly offset: number };
}

/** A drawing view in the view's millimetres (u right, v up, from the frame's origin). */
export interface ViewGeometry {
  readonly visible: readonly ProjectedCurve[];
  readonly hidden: readonly ProjectedCurve[];
  /** Outlines of the faces a section cut, as segments (for hatching by crossings). */
  readonly cut: readonly (readonly [Vec2, Vec2])[];
  /** Named model geometry to attach dimensions to. */
  readonly points: readonly { readonly name: string; readonly at: Vec2 }[];
  readonly circles: readonly { readonly name: string; readonly center: Vec2; readonly radius: number }[];
  readonly lines: readonly { readonly name: string; readonly start: Vec2; readonly end: Vec2 }[];
  /** Where each body is (the middle of its box), for balloons. */
  readonly bodies: readonly { readonly id: string; readonly at: Vec2 }[];
  readonly box: { readonly min: Vec2; readonly max: Vec2 };
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
    if (request.cut && shapes.length) {
      // The middle of all bodies, moved towards the viewer by the offset.
      const middle = shapes.map((s) => s.boundingBox.center as Vec3).reduce((sum, c) => [sum[0] + c[0] / shapes.length, sum[1] + c[1] / shapes.length, sum[2] + c[2] / shapes.length] as Vec3, [0, 0, 0] as Vec3);
      const plane = { origin: [middle[0] + n[0] * request.cut.offset, middle[1] + n[1] * request.cut.offset, middle[2] + n[2] * request.cut.offset] as Vec3, normal: n };
      const size = 1e5;
      const box = makeBox([-size, -size, 0], [size, size, size]) as Shape3D;
      owned.push(box);
      // The box above z = 0, turned so its z is the cut's normal and moved to the cut's origin.
      const z = normalize3(plane.normal);
      const x = normalize3(Math.abs(z[2]) < 0.9 ? cross3([0, 0, 1], z) : cross3([1, 0, 0], z));
      const tool = place(box, fromFrame(plane.origin, x, cross3(z, x), z));
      owned.push(tool);
      shapes = shapes.map((shape) => {
        const kept = shape.clone().cut(tool.clone()) as Shape3D;
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
    // makeCompound frees what it is given: clones, so the bodies and cut shapes stay.
    const compound = makeCompound(shapes.map((shape) => shape.clone()));
    owned.push(compound);
    const camera = new ProjectionCamera([...origin], [...n], [...u]);
    const projected = makeProjectedEdges(compound, camera, request.hidden);
    camera.delete();
    // The projection's edges lie in the camera's plane, in its coordinates.
    const plain = (p: Vec3): Vec2 => [p[0], p[1]];
    const curves = (edges: Edge[]) => edges.flatMap((e) => projectEdge(e, plain, [0, 0, 1]));
    const visible = curves(projected.visible);
    // Hidden edges right under visible ones (the bottom of a hole seen from above) are not drawn.
    const hidden = curves(projected.hidden).filter((curve) => !visible.some((shown) => covers(shown, curve)));
    for (const e of [...projected.visible, ...projected.hidden]) e.delete();

    // Named geometry of the (uncut) bodies, to dimension.
    const points: { name: string; at: Vec2 }[] = [];
    const circles: { name: string; center: Vec2; radius: number }[] = [];
    const lines: { name: string; start: Vec2; end: Vec2 }[] = [];
    for (const { named } of bodies) {
      for (const vertex of verticesOf(named)) points.push({ name: vertex.name, at: flat(vertex.point) });
      for (const edge of edgesOf(named.shape)) {
        const name = named.edges.get(edge.hashCode);
        if (!name) continue;
        for (const curve of projectEdge(edge, flat, n)) {
          if (curve.kind === 'line' && (edge.geomType as string) === 'LINE') lines.push({ name, start: curve.start, end: curve.end });
          else if (curve.kind !== 'line') circles.push({ name, center: curve.center, radius: Math.hypot(...(curve.kind === 'circle' ? [curve.radius, 0] : [curve.start[0] - curve.center[0], curve.start[1] - curve.center[1]])) });
        }
      }
    }
    const placed = bodies.map(({ id, named }) => ({ id, at: flat(named.shape.boundingBox.center as Vec3) }));
    return { visible, hidden, cut: cutFaces, points, circles, lines, bodies: placed, box: boxOf([...visible, ...hidden]) };
  } finally {
    for (const shape of owned) shape.delete();
  }
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
