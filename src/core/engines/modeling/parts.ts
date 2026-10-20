import type { NamedShape } from '@core/access/shape';
import type { PlaneFrame, Vec2, Vec3 } from '@core/contracts';
import { draw, drawCircle, type Drawing, drawPolysides, drawRectangle, Plane, type Shape3D } from 'replicad';
import { gearDrawing, rackOutline, ringGearDrawing } from './gears';
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
  /** `chamfer`: the teeth bevelled at both ends, that much at the tip (45°). */
  | { readonly kind: 'gear'; readonly module: number; readonly teeth: number; readonly width: number; readonly bore: number; readonly pressureAngle: number; readonly helixAngle: number; readonly chamfer?: number }
  /** An internal gear: a ring of `outside` diameter with the teeth on the inside. */
  | { readonly kind: 'ring-gear'; readonly module: number; readonly teeth: number; readonly width: number; readonly outside: number; readonly pressureAngle: number; readonly helixAngle: number }
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

/**
 * A gear's teeth bevelled at both ends (CAD-140): what lies inside a revolved section whose 45° cones
 * meet the end faces `chamfer` inside the tip circle. The section reaches past the ends and the tips,
 * so none of its faces lies on one of the gear's.
 */
function tipRelief(gear: Shape3D, solid: Extract<PartSolid, { kind: 'gear' }>, origin: Vec3, x: Vec3, y: Vec3, n: Vec3): Shape3D {
  const tip = (solid.module * Math.round(solid.teeth)) / 2 + solid.module;
  const [w, c, past] = [solid.width, solid.chamfer ?? 0, solid.module];
  if (!(c < Math.min(solid.module * 2, w / 2))) throw new PartError(`The chamfer must be less than ${Math.round(Math.min(solid.module * 2, w / 2) * 100) / 100} mm.`);
  const section = polygon([[0, -past], [tip - c - past, -past], [tip + past, c + past], [tip + past, w - c - past], [tip - c - past, w + past], [0, w + past]]);
  const tool = section.sketchOnPlane(new Plane([...origin], [...x], [...scale3(y, -1)])).revolve([...n], { origin: [...origin] }) as Shape3D;
  return gear.intersect(tool);
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
    case 'gear':
    case 'ring-gear': {
      const width = positive(solid.width, 'width');
      const module = positive(solid.module, 'module');
      let outline: Drawing;
      if (solid.kind === 'gear') {
        outline = gearDrawing(module, solid.teeth, solid.pressureAngle);
        if (solid.bore > 0) outline = outline.cut(drawCircle(solid.bore / 2));
      } else {
        const root = (module * Math.round(solid.teeth)) / 2 + 1.25 * module;
        if (!(solid.outside / 2 > root + module)) throw new PartError(`The outside diameter must be more than ${Math.round((2 * (root + module)) * 100) / 100} mm for these teeth.`);
        outline = drawCircle(solid.outside / 2).cut(ringGearDrawing(module, solid.teeth, solid.pressureAngle));
      }
      const pitchRadius = (module * Math.round(solid.teeth)) / 2;
      // Helical teeth: the outline turns as it rises, by the helix angle at the pitch circle.
      const twist = solid.helixAngle ? ((width * Math.tan(solid.helixAngle)) / pitchRadius) * (180 / Math.PI) : 0;
      const gear = outline.sketchOnPlane(on()).extrude(width, twist ? { twistAngle: twist } : {}) as Shape3D;
      return solid.kind === 'gear' && solid.chamfer ? tipRelief(gear, solid, origin, x, y, n) : gear;
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
