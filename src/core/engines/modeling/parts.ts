import type { NamedShape } from '@core/access/shape';
import type { PlaneFrame, Vec2, Vec3 } from '@core/contracts';
import { draw, drawCircle, type Drawing, drawPolysides, drawRectangle, Plane, type Shape3D } from 'replicad';
import { add3, cross3, normalOf, scale3, toWorld } from './geometry';
import { nameShape } from './naming';

/**
 * A part as the Modeling Engine builds it, with every size in millimetres and angles in radians
 * (the Design Manager resolves catalogue sizes and fits). Local coordinates: x along the plane's u
 * axis (turned), y along its v axis, z along its normal.
 */
export type PartSolid =
  /** A socket head screw: head on z ≥ 0, shank below. */
  | { readonly kind: 'screw'; readonly diameter: number; readonly length: number; readonly head: number; readonly headHeight: number; readonly socket: number }
  | { readonly kind: 'nut'; readonly diameter: number; readonly acrossFlats: number; readonly height: number }
  /** A ring (washer, bearing; an insert lies below the plane). */
  | { readonly kind: 'ring'; readonly inner: number; readonly outer: number; readonly height: number; readonly below: boolean }
  /** A round post (magnet, peg), chamfered at the top. */
  | { readonly kind: 'post'; readonly diameter: number; readonly height: number; readonly chamfer: number }
  | { readonly kind: 'gear'; readonly module: number; readonly teeth: number; readonly width: number; readonly bore: number; readonly pressureAngle: number; readonly helixAngle: number }
  | { readonly kind: 'rack'; readonly module: number; readonly teeth: number; readonly width: number; readonly height: number; readonly pressureAngle: number }
  | { readonly kind: 'snap-fit'; readonly length: number; readonly width: number; readonly thickness: number; readonly hook: number }
  | { readonly kind: 'dovetail'; readonly width: number; readonly depth: number; readonly length: number; readonly angle: number }
  /** A groove below the plane (a living hinge's thin web is what it leaves). */
  | { readonly kind: 'groove'; readonly length: number; readonly width: number; readonly depth: number };

/** A failure the user can act on. */
export class PartError extends Error {}

const positive = (value: number, what: string) => {
  if (!(value > 0)) throw new PartError(`The ${what} must be greater than zero.`);
  return value;
};

/** A plane through `origin` with x along `x` and its normal `n`, moved `z` along the normal. */
const planeAt = (origin: Vec3, x: Vec3, n: Vec3, z = 0) => new Plane([...add3(origin, scale3(n, z))], [...x], [...n]);

/** A closed polygon as a drawing. */
function polygon(points: readonly Vec2[]): Drawing {
  const [first, ...rest] = points as [Vec2, ...Vec2[]];
  let pen = draw([first[0], first[1]]);
  for (const p of rest) pen = pen.lineTo([p[0], p[1]]);
  return pen.close();
}

/** The outline of a spur gear with involute teeth, a tooth centred on the x axis. */
export function gearOutline(module: number, teeth: number, pressureAngle: number): Vec2[] {
  const z = Math.round(teeth);
  if (z < 6) throw new PartError('A gear needs at least 6 teeth.');
  const r = (module * z) / 2;
  const base = r * Math.cos(pressureAngle);
  const tip = r + module;
  const root = r - 1.25 * module;
  if (!(root > 0)) throw new PartError('The gear is too small for its module.');
  const involute = (a: number) => Math.tan(a) - a;
  // Half a tooth's angle at a radius: half the circular pitch at the pitch circle, narrowing outwards.
  const half = (rho: number) => Math.PI / (2 * z) + involute(pressureAngle) - involute(Math.acos(Math.min(1, base / rho)));
  const start = Math.max(base, root);
  const steps = 8;
  const flank = Array.from({ length: steps + 1 }, (_, i) => start + ((tip - start) * i) / steps);
  const polar = (rho: number, angle: number): Vec2 => [rho * Math.cos(angle), rho * Math.sin(angle)];
  const points: Vec2[] = [];
  for (let k = 0; k < z; k++) {
    const turn = (2 * Math.PI * k) / z;
    if (base > root) points.push(polar(root, turn - half(start)));
    for (const rho of flank) points.push(polar(rho, turn - half(rho)));
    for (const rho of [...flank].reverse()) points.push(polar(rho, turn + half(rho)));
    if (base > root) points.push(polar(root, turn + half(start)));
    // Along the root circle to the next tooth.
    const from = turn + half(start);
    const to = turn + (2 * Math.PI) / z - half(start);
    for (let i = 1; i < 4; i++) points.push(polar(root, from + ((to - from) * i) / 4));
  }
  return points;
}

/** The outline of a gear rack along x, the pitch line at y = height, teeth upwards. */
function rackOutline(module: number, teeth: number, height: number, pressureAngle: number): Vec2[] {
  const n = Math.round(teeth);
  if (n < 1) throw new PartError('A rack needs at least one tooth.');
  const pitch = Math.PI * module;
  const [top, bottom] = [height + module, height - 1.25 * module];
  if (!(bottom > 0)) throw new PartError('The rack is not high enough for its teeth.');
  const slope = Math.tan(pressureAngle);
  const [tipHalf, rootHalf] = [pitch / 4 - module * slope, pitch / 4 + 1.25 * module * slope];
  const length = n * pitch;
  const points: Vec2[] = [
    [0, 0],
    [length, 0],
  ];
  for (let k = n - 1; k >= 0; k--) {
    const c = (k + 0.5) * pitch;
    points.push([Math.min(length, c + rootHalf), bottom], [c + tipHalf, top], [c - tipHalf, top], [Math.max(0, c - rootHalf), bottom]);
  }
  return points;
}

/** One part at the origin of its local coordinates (see `PartSolid`). */
function partShape(solid: PartSolid, origin: Vec3, x: Vec3, y: Vec3, n: Vec3): Shape3D {
  const on = (z = 0) => planeAt(origin, x, n, z);
  switch (solid.kind) {
    case 'screw': {
      const head = drawCircle(positive(solid.head, 'head diameter') / 2).sketchOnPlane(on()).extrude(positive(solid.headHeight, 'head height')) as Shape3D;
      const depth = solid.headHeight * 0.6;
      const socket = drawPolysides(solid.socket / Math.sqrt(3), 6).sketchOnPlane(on(solid.headHeight - depth)).extrude(depth) as Shape3D;
      const shank = drawCircle(positive(solid.diameter, 'diameter') / 2).sketchOnPlane(on(-positive(solid.length, 'length'))).extrude(solid.length) as Shape3D;
      return head.cut(socket).fuse(shank);
    }
    case 'nut':
      return drawPolysides(positive(solid.acrossFlats, 'width across flats') / Math.sqrt(3), 6)
        .cut(drawCircle(positive(solid.diameter, 'diameter') / 2))
        .sketchOnPlane(on())
        .extrude(positive(solid.height, 'height')) as Shape3D;
    case 'ring': {
      if (!(solid.outer > solid.inner)) throw new PartError('The outside diameter must be greater than the inside one.');
      const height = positive(solid.height, 'height');
      return drawCircle(solid.outer / 2)
        .cut(drawCircle(positive(solid.inner, 'inside diameter') / 2))
        .sketchOnPlane(on(solid.below ? -height : 0))
        .extrude(height) as Shape3D;
    }
    case 'post': {
      const [r, h] = [positive(solid.diameter, 'diameter') / 2, positive(solid.height, 'height')];
      const c = Math.min(solid.chamfer, r * 0.5, h * 0.5);
      // Revolved from its half section, in the plane through the axis and x.
      const section = polygon(c > 0 ? [[0, 0], [r, 0], [r, h - c], [r - c, h], [0, h]] : [[0, 0], [r, 0], [r, h], [0, h]]);
      return section.sketchOnPlane(new Plane([...origin], [...x], [...scale3(y, -1)])).revolve([...n], { origin: [...origin] }) as Shape3D;
    }
    case 'gear': {
      const width = positive(solid.width, 'width');
      let outline: Drawing = polygon(gearOutline(positive(solid.module, 'module'), solid.teeth, solid.pressureAngle));
      if (solid.bore > 0) outline = outline.cut(drawCircle(solid.bore / 2));
      const pitchRadius = (solid.module * Math.round(solid.teeth)) / 2;
      // Helical teeth: the outline turns as it rises, by the helix angle at the pitch circle.
      const twist = solid.helixAngle ? ((width * Math.tan(solid.helixAngle)) / pitchRadius) * (180 / Math.PI) : 0;
      return outline.sketchOnPlane(on()).extrude(width, twist ? { twistAngle: twist } : {}) as Shape3D;
    }
    case 'rack':
      return polygon(rackOutline(positive(solid.module, 'module'), solid.teeth, positive(solid.height, 'height'), solid.pressureAngle))
        .sketchOnPlane(on())
        .extrude(positive(solid.width, 'width')) as Shape3D;
    case 'snap-fit': {
      const [l, w, t, h] = [positive(solid.length, 'length'), positive(solid.width, 'width'), positive(solid.thickness, 'thickness'), positive(solid.hook, 'hook')];
      if (1.5 * h >= l) throw new PartError('The hook is too big for the arm.');
      // The side view (y, z): the arm, a square retention face and a sloped lead-in; extruded across x.
      const side = polygon([[0, 0], [t, 0], [t, l - 1.5 * h], [t + h, l - 1.5 * h], [t, l], [0, l]]);
      return side.sketchOnPlane(new Plane([...add3(origin, scale3(x, -w / 2))], [...y], [...x])).extrude(w) as Shape3D;
    }
    case 'dovetail': {
      const [w, d, l] = [positive(solid.width, 'width'), positive(solid.depth, 'depth'), positive(solid.length, 'length')];
      const flare = d * Math.tan(solid.angle);
      // The end view (x, z): narrow at the plane, wider at the top; along y.
      const end = polygon([[-w / 2, 0], [w / 2, 0], [w / 2 + flare, d], [-w / 2 - flare, d]]);
      return end.sketchOnPlane(new Plane([...add3(origin, scale3(y, l / 2))], [...x], [...scale3(y, -1)])).extrude(l) as Shape3D;
    }
    case 'groove': {
      const depth = positive(solid.depth, 'depth');
      return drawRectangle(positive(solid.length, 'length'), positive(solid.width, 'width')).sketchOnPlane(on(-depth)).extrude(depth) as Shape3D;
    }
  }
}

/**
 * All copies of a part as one tool: one at each point of the plane, turned by `angle` about the
 * normal and, flipped, on the other side of the plane. Faces are named by kind of surface.
 */
export function partTool(feature: string, frame: PlaneFrame, points: readonly { readonly id: string; readonly at: Vec2 }[], angle: number, flip: boolean, solid: PartSolid): NamedShape {
  if (!points.length) throw new PartError('Put points in the sketch where the parts go.');
  const n = flip ? scale3(normalOf(frame), -1) : normalOf(frame);
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const x = add3(scale3(frame.u, cos), scale3(frame.v, flip ? -sin : sin));
  const y = cross3(n, x);
  const shapes = points.map((p) => partShape(solid, toWorld(frame, p.at), x, y, n));
  const [first, ...rest] = shapes as [Shape3D, ...Shape3D[]];
  const shape = rest.reduce((all, s) => all.fuse(s), first);
  return nameShape(shape, [], (_face, surface) => `f:${feature}:${surface.type}`, feature);
}
