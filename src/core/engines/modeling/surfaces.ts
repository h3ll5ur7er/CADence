import type { Vec3 } from '@core/contracts';
import { type Face, getOC, measureArea } from 'replicad';
import { cross3, dot3, length3, normalize3, sub3 } from './geometry';

/**
 * The exact surface a face lies on. Faces keep their surface through trims and booleans, which makes
 * the surface the stable identity used for persistent naming.
 */
export type Surface =
  | { readonly type: 'plane'; readonly normal: Vec3; readonly offset: number }
  | { readonly type: 'cylinder'; readonly axis: Line; readonly radius: number }
  | { readonly type: 'cone'; readonly axis: Line; readonly apex: Vec3; readonly angle: number }
  | { readonly type: 'sphere'; readonly center: Vec3; readonly radius: number }
  /**
   * Any other surface (B-splines, tori, …): its centre and area, and probe points on the untrimmed
   * surface, which tell whether a later face lies on the same surface however it was trimmed.
   */
  | { readonly type: 'other'; readonly center: Vec3; readonly area: number; readonly probes: readonly Vec3[] };

export interface Line {
  readonly point: Vec3;
  readonly direction: Vec3;
}

const tolerance = 1e-5;
const near = (a: number, b: number) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const samePoint = (a: Vec3, b: Vec3) => length3(sub3(a, b)) <= tolerance * Math.max(1, length3(a));

const distanceToLine = (p: Vec3, line: Line): number => length3(cross3(sub3(p, line.point), line.direction));

/** Same infinite line, whatever the direction's sign. */
export function sameLine(a: Line, b: Line): boolean {
  return near(Math.abs(dot3(a.direction, b.direction)), 1) && distanceToLine(b.point, a) <= tolerance * 10;
}

export function sameSurface(a: Surface, b: Surface): boolean {
  switch (a.type) {
    case 'plane':
      return b.type === 'plane' && samePoint(a.normal, b.normal) && near(a.offset, b.offset);
    case 'cylinder':
      return b.type === 'cylinder' && near(a.radius, b.radius) && sameLine(a.axis, b.axis);
    case 'cone':
      return b.type === 'cone' && samePoint(a.apex, b.apex) && near(a.angle, b.angle) && sameLine(a.axis, b.axis);
    case 'sphere':
      return b.type === 'sphere' && samePoint(a.center, b.center) && near(a.radius, b.radius);
    case 'other':
      return b.type === 'other' && samePoint(a.center, b.center) && near(a.area, b.area);
  }
}

/** A plane's identity ignores its orientation (for comparing with profile-derived planes). */
export function samePlaneIgnoringSide(a: Surface, b: Surface): boolean {
  if (a.type !== 'plane' || b.type !== 'plane') return false;
  const sign = dot3(a.normal, b.normal) < 0 ? -1 : 1;
  return near(Math.abs(dot3(a.normal, b.normal)), 1) && near(a.offset, sign * b.offset);
}

interface Xyz {
  X(): number;
  Y(): number;
  Z(): number;
}
interface Axis {
  Location(): Xyz;
  Direction(): Xyz;
}
const tuple = (p: Xyz): Vec3 => [p.X(), p.Y(), p.Z()];
const lineOf = (axis: Axis): Line => ({ point: tuple(axis.Location()), direction: normalize3(tuple(axis.Direction())) });

/** Where probes sit in a face's parameter range. */
const probeSpots: readonly (readonly [number, number])[] = [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]];

/** Whether all the points lie on the (untrimmed) surface of the face. */
export function liesOn(face: Face, points: readonly Vec3[]): boolean {
  const oc = getOC();
  const surface = oc.BRep_Tool.Surface(face.wrapped);
  try {
    return points.every((p) => {
      const point = new oc.gp_Pnt(p[0], p[1], p[2]);
      const projection = new oc.GeomAPI_ProjectPointOnSurf(point, surface, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad);
      try {
        return projection.NbPoints() > 0 && projection.LowerDistance() <= tolerance * Math.max(1, length3(p));
      } finally {
        projection.delete();
        point.delete();
      }
    });
  } finally {
    surface.delete();
  }
}

/** Reads the face's surface from OpenCascade. */
export function surfaceOf(face: Face): Surface {
  const center = face.center.toTuple() as Vec3;
  const type = face.geomType;
  if (type === 'PLANE') {
    const normal = normalize3(face.normalAt(face.center).toTuple() as Vec3);
    return { type: 'plane', normal, offset: dot3(normal, center) };
  }
  const adaptor = new (getOC().BRepAdaptor_Surface)(face.wrapped, false);
  try {
    switch (type) {
      case 'CYLINDRE': {
        const c = adaptor.Cylinder();
        return { type: 'cylinder', axis: lineOf(c.Axis()), radius: c.Radius() };
      }
      case 'CONE': {
        const c = adaptor.Cone() as { SemiAngle(): number; Apex(): Xyz; Axis(): Axis };
        return { type: 'cone', axis: lineOf(c.Axis()), apex: tuple(c.Apex()), angle: Math.abs(c.SemiAngle()) };
      }
      case 'SPHERE': {
        const c = adaptor.Sphere();
        return { type: 'sphere', center: tuple(c.Location()), radius: c.Radius() };
      }
      default: {
        const probes = probeSpots.map(([u, v]) => face.pointOnSurface(u, v).toTuple() as Vec3);
        return { type: 'other', center, area: measureArea(face), probes };
      }
    }
  } finally {
    adaptor.delete();
  }
}
