import { adopt, type NamedShape } from '@core/access/shape';
import type { PlaneFrame, Vec3 } from '@core/contracts';
import { draw, drawCircle, type Drawing, type Face, getOC, type Shape3D } from 'replicad';
import { cut, fuse, solidsOf } from './booleans';
import { dot3, normalOf, sub3, toPlane } from './geometry';
import type { PathPiece } from './modeling-engine';
import { nameShape, namedSurfaces } from './naming';

/** A failure the user can act on. */
export class DraftRibError extends Error {}

/**
 * Tilts faces by `angle` (radians) away from the pull direction (the plane's normal), hinged where
 * they cross the plane. Drafted faces keep their names: they are the same faces, tilted.
 */
export function draftFaces(named: NamedShape, faces: readonly Face[], frame: PlaneFrame, angle: number, feature: string): NamedShape {
  const oc = getOC();
  const normal = normalOf(frame);
  const direction = new oc.gp_Dir(normal[0], normal[1], normal[2]);
  const origin = new oc.gp_Pnt(frame.origin[0], frame.origin[1], frame.origin[2]);
  const plane = new oc.gp_Pln(origin, direction);
  // Read the names first: the draft works on the shape it is given.
  const candidates = namedSurfaces(named);
  const builder = new oc.BRepOffsetAPI_DraftAngle(named.shape.wrapped);
  try {
    for (const face of faces) {
      builder.Add(face.wrapped, direction, angle, plane, true);
      if (!builder.AddDone()) throw new DraftRibError('A selected face cannot be drafted: pick side faces that meet the neutral plane.');
    }
    builder.Build();
    if (!builder.IsDone()) throw new DraftRibError('The draft could not be built with this angle.');
    const shape = adopt(builder.Shape()) as Shape3D;
    // The drafted faces by their history: each keeps the name it had.
    const drafted = new Map<number, string>();
    for (const face of faces) {
      const name = named.faces.get(face.hashCode);
      const modified = adopt(builder.ModifiedShape(face.wrapped));
      if (name && 'normalAt' in modified) drafted.set((modified as Face).hashCode, name);
    }
    return nameShape(shape, candidates, (face) => drafted.get(face.hashCode), feature);
  } finally {
    builder.delete();
    plane.delete();
    origin.delete();
    direction.delete();
  }
}

/** The path's curves thickened to `thickness` (half on each side; square ends, round joints), in the plane's (u, v). */
function ribOutline(frame: PlaneFrame, path: readonly PathPiece[], thickness: number): Drawing {
  const half = thickness / 2;
  const flat = (p: Vec3): [number, number] => {
    const d = sub3(p, frame.origin);
    return [dot3(d, frame.u), dot3(d, frame.v)];
  };
  const band = (a: [number, number], b: [number, number]): Drawing => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [nx, ny] = [(-(b[1] - a[1]) / length) * half, ((b[0] - a[0]) / length) * half];
    return draw([a[0] + nx, a[1] + ny]).lineTo([b[0] + nx, b[1] + ny]).lineTo([b[0] - nx, b[1] - ny]).lineTo([a[0] - nx, a[1] - ny]).close();
  };
  const pieces: Drawing[] = [];
  const joints: [number, number][] = [];
  for (const [i, piece] of path.entries()) {
    if (i > 0) joints.push(flat(piece.kind === 'bezier' ? piece.points[0] : piece.start));
    if (piece.kind === 'line') {
      pieces.push(band(flat(piece.start), flat(piece.end)));
    } else if (piece.kind === 'bezier') {
      const points = Array.from({ length: 17 }, (_, k) => {
        const t = k / 16;
        const [a, b, c, d] = piece.points.map(flat) as [[number, number], [number, number], [number, number], [number, number]];
        const w = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
        return [0, 1].map((k2) => (w[0] as number) * (a[k2] as number) + (w[1] as number) * (b[k2] as number) + (w[2] as number) * (c[k2] as number) + (w[3] as number) * (d[k2] as number)) as [number, number];
      });
      for (let k = 1; k < points.length; k++) {
        pieces.push(band(points[k - 1] as [number, number], points[k] as [number, number]));
        if (k > 1) joints.push(points[k - 1] as [number, number]);
      }
    } else {
      // An arc: the ring between the radius ± half the thickness, from start through mid to end.
      const [a, m, b] = [flat(piece.start), flat(piece.mid), flat(piece.end)];
      const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
      const sq = (p: [number, number]) => p[0] * p[0] + p[1] * p[1];
      const c: [number, number] = [(sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d, (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d];
      const r = Math.hypot(a[0] - c[0], a[1] - c[1]);
      if (r <= half) throw new DraftRibError('An arc of the rib is tighter than half its thickness.');
      const at = (p: [number, number], radius: number): [number, number] => {
        const k = radius / Math.hypot(p[0] - c[0], p[1] - c[1]);
        return [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k];
      };
      const [outer, inner] = [r + half, r - half];
      pieces.push(
        draw(at(a, outer))
          .threePointsArcTo(at(b, outer), at(m, outer))
          .lineTo(at(b, inner))
          .threePointsArcTo(at(a, inner), at(m, inner))
          .close(),
      );
    }
  }
  for (const p of joints) pieces.push(drawCircle(half).translate(p[0], p[1]));
  const [first, ...rest] = pieces as [Drawing, ...Drawing[]];
  return rest.reduce((all, piece) => all.fuse(piece), first);
}

/**
 * A rib: the path's curves thickened to `thickness` and extruded `depth` along the plane's normal (or
 * against it, or half each way).
 */
export function ribTool(feature: string, frame: PlaneFrame, path: readonly PathPiece[], thickness: number, depth: number, direction: 'normal' | 'reverse' | 'symmetric'): NamedShape {
  const outline = ribOutline(frame, path, thickness);
  const normal = normalOf(frame);
  const from = direction === 'normal' ? 0 : direction === 'reverse' ? -depth : -depth / 2;
  const shape = outline.sketchOnPlane(toPlane(frame, from)).extrude(depth) as Shape3D;
  const along = (p: Vec3) => dot3(p, normal);
  const base = along(frame.origin) + from;
  return nameShape(
    shape,
    [],
    (f, surface) => {
      if (surface.type !== 'plane' || Math.abs(Math.abs(dot3(surface.normal, normal)) - 1) > 1e-6) return `f:${feature}:side`;
      return along(f.center.toTuple() as Vec3) < base + depth / 2 ? `f:${feature}:start` : `f:${feature}:end`;
    },
    feature,
  );
}

/**
 * A rib up to the next face (CAD-156): the outline extruded `reach` from the sketch plane (each way
 * when symmetric), less the bodies, keeping the part from the plane to where it first meets them. The
 * end follows the face it meets, whatever its shape.
 */
export function ribToNext(feature: string, frame: PlaneFrame, path: readonly PathPiece[], thickness: number, direction: 'normal' | 'reverse' | 'symmetric', bodies: readonly Shape3D[], reach: number): NamedShape {
  const normal = normalOf(frame);
  const along = (p: Vec3) => dot3(sub3(p, frame.origin), normal);
  const sides = direction === 'symmetric' ? [1, -1] : [direction === 'normal' ? 1 : -1];
  const pieces = sides.flatMap((side) => {
    const long = ribOutline(frame, path, thickness).sketchOnPlane(toPlane(frame, side > 0 ? 0 : -reach)).extrude(reach) as Shape3D;
    const left = bodies.length ? cut(long, ...bodies.map((b) => b.clone())) : long;
    // How far each piece left starts and ends from the sketch plane, on this side.
    const spans = solidsOf(left).map((solid) => {
      const ends = solid.edges.flatMap((e) => [e.startPoint.toTuple(), e.endPoint.toTuple()] as Vec3[]).map((p) => side * along(p));
      return { solid, near: Math.min(...ends), far: Math.max(...ends) };
    });
    if (!spans.length) throw new DraftRibError('The rib’s sketch lies inside the body: there is no gap to fill.');
    const first = Math.min(...spans.map((s) => s.near));
    const kept = spans.filter((s) => s.near < Math.max(first, 0) + 1e-6);
    if (kept.some((s) => s.far > reach - 1e-6)) throw new DraftRibError('The rib meets no face in its direction: give it a depth instead.');
    return kept.map((s) => s.solid);
  });
  const [one, ...more] = pieces as [Shape3D, ...Shape3D[]];
  const shape = more.length ? fuse(one, ...more) : one;
  return nameShape(
    shape,
    [],
    (f) => {
      const n = f.normalAt(f.center).toTuple() as Vec3;
      if (Math.abs(dot3(n, normal)) < 1e-6) return `f:${feature}:side`;
      return f.geomType === 'PLANE' && Math.abs(along(f.center.toTuple() as Vec3)) < 1e-6 ? `f:${feature}:start` : `f:${feature}:end`;
    },
    feature,
  );
}
