import type { NamedShape } from '@core/access/shape';
import type { PlaneFrame, Profile, ProfileEdge, Vec3 } from '@core/contracts';
import type { Face, Shape3D } from 'replicad';
import { cross3, dot3, length3, normalize3, normalOf, scale3, sub3, toPlane, toWorld, add3 } from './geometry';
import { nameShape } from './naming';
import { type Line, sameLine, samePlaneIgnoringSide, type Surface } from './surfaces';
import { profilesDrawing } from './geometry';

/** The surface a profile edge sweeps out, to recognise which tool face it made. */
type Expected = { readonly source: string; readonly matches: (surface: Surface) => boolean };

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(a), Math.abs(b));
const distanceToLine = (p: Vec3, line: Line) => length3(cross3(sub3(p, line.point), line.direction));

function edgesOf(profiles: readonly Profile[]): ProfileEdge[] {
  return profiles.flatMap((p) => [p.outer, ...p.holes].flatMap((loop) => loop.edges));
}

/** Names tool faces: caps by position, sides by the sketch curve that swept them. */
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
      const side = expected.find((e) => e.matches(surface));
      return side ? `f:${feature}:side:${side.source}` : undefined;
    },
    feature,
  );
}

export function extrudeTool(
  feature: string,
  frame: PlaneFrame,
  profiles: readonly Profile[],
  distance: number,
  direction: 'normal' | 'reverse' | 'symmetric',
): NamedShape {
  const n = normalOf(frame);
  const drawing = profilesDrawing(profiles);
  const shape =
    direction === 'symmetric'
      ? drawing.sketchOnPlane(toPlane(frame, -distance / 2)).extrude(distance)
      : drawing.sketchOnPlane(toPlane(frame)).extrude(distance, direction === 'reverse' ? { extrusionDirection: [...scale3(n, -1)] } : {});
  const shape3d = shape as Shape3D;
  // Caps: planes normal to the extrusion; the one nearer the sketch's side of travel is "start".
  const [low, high] = direction === 'normal' ? [0, distance] : direction === 'reverse' ? [-distance, 0] : [-distance / 2, distance / 2];
  const along = (offset: number) => offset - dot3(n, frame.origin);
  const cap = (surface: Surface) => {
    if (surface.type !== 'plane' || !near(Math.abs(dot3(surface.normal, n)), 1)) return undefined;
    const t = along(dot3(surface.normal, n) > 0 ? surface.offset : -surface.offset);
    return Math.abs(t - low) < Math.abs(t - high) ? 'start' : 'end';
  };
  const expected = edgesOf(profiles).map((edge): Expected => {
    if (edge.kind === 'line') {
      const p = toWorld(frame, edge.start);
      const normal = normalize3(cross3(sub3(toWorld(frame, edge.end), p), n));
      const plane: Surface = { type: 'plane', normal, offset: dot3(normal, p) };
      return { source: edge.source, matches: (s) => samePlaneIgnoringSide(s, plane) };
    }
    const axis: Line = { point: toWorld(frame, edge.center), direction: n };
    return { source: edge.source, matches: (s) => s.type === 'cylinder' && near(s.radius, edge.radius) && sameLine(s.axis, axis) };
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
  const shape = profilesDrawing(profiles)
    .sketchOnPlane(toPlane(frame))
    .revolve([...direction], { origin: [...axis.origin], angle: (angle * 180) / Math.PI }) as Shape3D;
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
    if (edge.kind === 'line') {
      const [p, q] = [toWorld(frame, edge.start), toWorld(frame, edge.end)];
      const d = normalize3(sub3(q, p));
      const along = dot3(d, direction);
      if (near(Math.abs(along), 1)) {
        const radius = distanceToLine(p, line);
        return { source: edge.source, matches: (s) => s.type === 'cylinder' && near(s.radius, radius) && sameLine(s.axis, line) };
      }
      if (near(along, 0)) {
        const plane: Surface = { type: 'plane', normal: direction, offset: dot3(direction, p) };
        return { source: edge.source, matches: (s) => samePlaneIgnoringSide(s, plane) };
      }
      // A slanted line sweeps a cone whose apex is where the line meets the axis.
      const apex = closestOnAxis(p, d, line);
      return { source: edge.source, matches: (s) => s.type === 'cone' && length3(sub3(s.apex, apex)) < 1e-4 && sameLine(s.axis, line) };
    }
    const center = toWorld(frame, edge.center);
    const offAxis = distanceToLine(center, line);
    if (offAxis < 1e-6) return { source: edge.source, matches: (s) => s.type === 'sphere' && near(s.radius, edge.radius) };
    return {
      source: edge.source,
      matches: (s) => s.type === 'torus' && near(s.minor, edge.radius) && near(s.major, offAxis) && sameLine(s.axis, line),
    };
  });
  return nameTool(shape, feature, expected, cap);
}

function distanceToPlane(p: Vec3, plane: Extract<Surface, { type: 'plane' }>): number {
  return Math.abs(dot3(plane.normal, p) - plane.offset);
}

/** Point on the axis closest to the line through `p` with direction `d` (where they meet, if they do). */
function closestOnAxis(p: Vec3, d: Vec3, axis: Line): Vec3 {
  const w = sub3(p, axis.point);
  const a = dot3(d, d);
  const b = dot3(d, axis.direction);
  const c = dot3(axis.direction, axis.direction);
  const e = dot3(d, w);
  const f = dot3(axis.direction, w);
  const t = (a * f - b * e) / (a * c - b * b);
  return add3(axis.point, scale3(axis.direction, t));
}
