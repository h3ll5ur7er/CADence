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
  | { readonly type: 'torus'; readonly axis: Line; readonly major: number; readonly minor: number }
  | { readonly type: 'other'; readonly center: Vec3; readonly area: number };

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
    case 'torus':
      return b.type === 'torus' && near(a.major, b.major) && near(a.minor, b.minor) && sameLine(a.axis, b.axis);
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
      case 'TORUS': {
        const t = adaptor.Torus() as { MajorRadius(): number; MinorRadius(): number; Axis(): Axis };
        return { type: 'torus', axis: lineOf(t.Axis()), major: t.MajorRadius(), minor: t.MinorRadius() };
      }
      default:
        return { type: 'other', center, area: measureArea(face) };
    }
  } finally {
    adaptor.delete();
  }
}
