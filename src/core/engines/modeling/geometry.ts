import type { PlaneFrame, Profile, ProfileLoop, Vec2, Vec3 } from '@core/contracts';
import { ccwSweep, ellipseParameter } from '@core/utilities/math';
import { draw, type Drawing, Plane } from 'replicad';

/** 3D vector helpers on tuples. */
export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize3 = (a: Vec3): Vec3 => scale3(a, 1 / (length3(a) || 1));

export const normalOf = (frame: PlaneFrame): Vec3 => cross3(frame.u, frame.v);

/** Sketch-plane coordinates to world coordinates. */
export const toWorld = (frame: PlaneFrame, p: Vec2): Vec3 => add3(frame.origin, add3(scale3(frame.u, p[0]), scale3(frame.v, p[1])));

export function toPlane(frame: PlaneFrame, offsetAlongNormal = 0): Plane {
  const normal = normalOf(frame);
  return new Plane([...add3(frame.origin, scale3(normal, offsetAlongNormal))], [...frame.u], [...normal]);
}

function loopDrawing(loop: ProfileLoop): Drawing {
  const [first] = loop.edges;
  if (!first) throw new Error('Empty profile loop');
  const pen = draw([first.start[0], first.start[1]]);
  for (const edge of loop.edges) {
    if (edge.kind === 'line') {
      pen.lineTo([edge.end[0], edge.end[1]]);
      continue;
    }
    if (edge.kind === 'bezier') {
      pen.cubicBezierCurveTo([edge.end[0], edge.end[1]], [edge.c1[0], edge.c1[1]], [edge.c2[0], edge.c2[1]]);
      continue;
    }
    if (edge.kind === 'ellipse') {
      // As in SVG: the sweep flag picks the counter-clockwise way round (Y up), the long-axis flag the longer piece.
      const ellipse = { center: edge.center, a: edge.a, b: edge.b, rotation: edge.rotation };
      const t0 = ellipseParameter(ellipse, edge.start);
      const t1 = ellipseParameter(ellipse, edge.end);
      const sweep = edge.ccw ? ccwSweep(t0, t1) : ccwSweep(t1, t0);
      pen.ellipseTo([edge.end[0], edge.end[1]], edge.a, edge.b, (edge.rotation * 180) / Math.PI, sweep > Math.PI + 1e-9, edge.ccw);
      continue;
    }
    const a0 = Math.atan2(edge.start[1] - edge.center[1], edge.start[0] - edge.center[0]);
    const a1 = Math.atan2(edge.end[1] - edge.center[1], edge.end[0] - edge.center[0]);
    const mid = edge.ccw ? a0 + ccwSweep(a0, a1) / 2 : a0 - ccwSweep(a1, a0) / 2;
    pen.threePointsArcTo(
      [edge.end[0], edge.end[1]],
      [edge.center[0] + edge.radius * Math.cos(mid), edge.center[1] + edge.radius * Math.sin(mid)],
    );
  }
  return pen.close();
}

/** One drawing for several profiles: outer loops fused, holes cut. */
export function profilesDrawing(profiles: readonly Profile[]): Drawing {
  let result: Drawing | undefined;
  for (const profile of profiles) {
    let drawing = loopDrawing(profile.outer);
    for (const hole of profile.holes) drawing = drawing.cut(loopDrawing(hole));
    result = result ? result.fuse(drawing) : drawing;
  }
  if (!result) throw new Error('Select at least one profile.');
  return result;
}
