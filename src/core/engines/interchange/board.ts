import { facesOf, type NamedShape } from '@core/access/shape';
import type { Vec2 } from '@core/contracts';
import {
  assembleWire,
  basicFaceExtrusion,
  type Edge,
  getOC,
  makeCircle,
  makeCompound,
  makeCylinder,
  makeFace,
  makeLine,
  makePolygon,
  makeThreePointArc,
  measureVolume,
  type Shape3D,
  Vector,
  type Wire,
} from 'replicad';
import { type Board, type BoardHole, type BoardLoop, loopPoints, reverseLoop, signedArea } from './kicad';

/** How tall a part is drawn when its footprint has no `Height` field and no STEP model in the project. */
export const defaultPartHeight = 3;

/** A board as solids (CAD-170): the board with its holes named, and its parts as one more solid. */
export interface BoardSolids {
  readonly board: NamedShape;
  readonly parts?: Shape3D;
  /** How many parts are their STEP models (the others are boxes of their courtyard). */
  readonly models: number;
}

/** A loop as a wire at height z; circles run clockwise (seen from above) in the holes of a face. */
const wireOf = (loop: BoardLoop, z: number, hole = false): Wire =>
  assembleWire(
    loop.map((s): Edge =>
      s.kind === 'line'
        ? makeLine([s.start[0], s.start[1], z], [s.end[0], s.end[1], z])
        : s.kind === 'arc'
          ? makeThreePointArc([s.start[0], s.start[1], z], [s.mid[0], s.mid[1], z], [s.end[0], s.end[1], z])
          : makeCircle(s.radius, [s.center[0], s.center[1], z], [0, 0, hole ? -1 : 1]),
    ),
  );

/** A hole's outline, clockwise (as the faces' holes run). */
function holeLoop(hole: BoardHole): BoardLoop {
  const r = hole.diameter / 2;
  if (!hole.slot) return [{ kind: 'circle', center: hole.center, radius: r }];
  const half = (hole.slot.length - hole.diameter) / 2;
  const [c, s] = [Math.cos(hole.slot.angle), Math.sin(hole.slot.angle)];
  const point = (along: number, across: number): Vec2 => [hole.center[0] + along * c - across * s, hole.center[1] + along * s + across * c];
  // Counter-clockwise: along the bottom side, round the far end, back along the top, round the near end.
  const loop: BoardLoop = [
    { kind: 'line', start: point(-half, -r), end: point(half, -r) },
    { kind: 'arc', start: point(half, -r), mid: point(half + r, 0), end: point(half, r) },
    { kind: 'line', start: point(half, r), end: point(-half, r) },
    { kind: 'arc', start: point(-half, r), mid: point(-half - r, 0), end: point(-half, -r) },
  ];
  return reverseLoop(loop);
}

const clockwise = (loop: BoardLoop): BoardLoop => (signedArea(loopPoints(loop)) > 0 ? reverseLoop(loop) : loop);

/**
 * The board: its outline less cut-outs and holes, extruded by its thickness from z = 0. Faces are
 * named: `board:top`, `board:bottom`, and each hole's wall by the hole's name.
 */
function boardSolid(board: Board, shift: Vec2): NamedShape {
  const moved = (loop: BoardLoop): BoardLoop =>
    loop.map((s) =>
      s.kind === 'circle'
        ? { ...s, center: [s.center[0] - shift[0], s.center[1] - shift[1]] }
        : s.kind === 'arc'
          ? { kind: 'arc', start: [s.start[0] - shift[0], s.start[1] - shift[1]], mid: [s.mid[0] - shift[0], s.mid[1] - shift[1]], end: [s.end[0] - shift[0], s.end[1] - shift[1]] }
          : { kind: 'line', start: [s.start[0] - shift[0], s.start[1] - shift[1]], end: [s.end[0] - shift[0], s.end[1] - shift[1]] },
    );
  const holes = board.holes.map((h) => ({ ...h, center: [h.center[0] - shift[0], h.center[1] - shift[1]] as Vec2 }));
  const outer = wireOf(moved(board.outline), 0);
  const inner = [...board.cutouts.map((c) => clockwise(moved(c))), ...holes.map(holeLoop)].map((loop) => wireOf(loop, 0, true));
  let solid = basicFaceExtrusion(makeFace(outer, inner), new Vector([0, 0, board.thickness])) as Shape3D;
  if (!valid(solid)) {
    // Holes that touch each other or the edge make the face invalid: cut them one by one instead.
    solid.delete();
    solid = basicFaceExtrusion(makeFace(outer), new Vector([0, 0, board.thickness])) as Shape3D;
    const tools = [...board.cutouts.map((c) => basicFaceExtrusion(makeFace(wireOf(moved(c), -1)), new Vector([0, 0, board.thickness + 2])) as Shape3D), ...holes.map((h) => holeTool(h, board.thickness))];
    if (tools.length) solid = solid.cut(makeCompound(tools) as unknown as Shape3D) as Shape3D;
  }
  return { shape: solid, faces: holeNames(solid, holes, board.thickness), edges: new Map() };
}

function holeTool(hole: BoardHole, thickness: number): Shape3D {
  if (!hole.slot) return makeCylinder(hole.diameter / 2, thickness + 2, [hole.center[0], hole.center[1], -1]) as Shape3D;
  return basicFaceExtrusion(makeFace(wireOf(reverseLoop(holeLoop(hole)), -1)), new Vector([0, 0, thickness + 2])) as Shape3D;
}

function valid(shape: Shape3D): boolean {
  const oc = getOC();
  const check = new oc.BRepCheck_Analyzer(shape.wrapped, true, false);
  try {
    return check.IsValid() && measureVolume(shape) > 0;
  } finally {
    check.delete();
  }
}

/** Names of the board's faces: its top and bottom, and the walls of its holes by the hole's name. */
function holeNames(solid: Shape3D, holes: readonly BoardHole[], thickness: number): Map<number, string> {
  const oc = getOC();
  const names = new Map<number, string>();
  for (const face of facesOf(solid)) {
    const adaptor = new oc.BRepAdaptor_Surface(face.wrapped, false);
    try {
      const type = adaptor.GetType();
      if (type === oc.GeomAbs_SurfaceType.GeomAbs_Plane) {
        const z = face.center.z;
        const normal = face.normalAt().z;
        if (Math.abs(z - thickness) < 1e-6 && normal > 0.99) names.set(face.hashCode, 'board:top');
        else if (Math.abs(z) < 1e-6 && normal < -0.99) names.set(face.hashCode, 'board:bottom');
      } else if (type === oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) {
        const cylinder = adaptor.Cylinder();
        const location = cylinder.Location();
        const [x, y, r] = [location.X(), location.Y(), cylinder.Radius()];
        const hole = holes.find((h) => {
          if (Math.abs(h.diameter / 2 - r) > 1e-4) return false;
          // A slot's round ends are half cylinders about the centres of its ends.
          const slot = h.slot;
          const ends: Vec2[] = slot
            ? [-1, 1].map((sign) => [h.center[0] + (sign * (slot.length - h.diameter) * Math.cos(slot.angle)) / 2, h.center[1] + (sign * (slot.length - h.diameter) * Math.sin(slot.angle)) / 2] as Vec2)
            : [h.center];
          return ends.some((c) => Math.hypot(c[0] - x, c[1] - y) < 1e-4);
        });
        if (hole) names.set(face.hashCode, hole.name);
      }
    } finally {
      adaptor.delete();
    }
  }
  return names;
}

const radians = Math.PI / 180;

/**
 * A board's solids: the board, and its parts as boxes of their outline and height above (or below)
 * it, or as their STEP models where the project has them (`models`, by lower-case model name). The
 * board's lower left corner is at the origin and its bottom on the XY plane.
 */
export function boardSolids(board: Board, models: ReadonlyMap<string, readonly Shape3D[]>): BoardSolids {
  const points = loopPoints(board.outline);
  const shift: Vec2 = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))];
  const solid = boardSolid(board, shift);
  const pieces: Shape3D[] = [];
  let modelled = 0;
  for (const part of board.parts) {
    const z = part.side === 'top' ? board.thickness : 0;
    const placedModels = part.models.flatMap((model) =>
      (models.get(model.name) ?? []).map((shape) => {
        // KiCad's placement of a model: scaled, turned about x, y, z (the other way), moved by its offset;
        // turned over for the bottom side; then turned and moved with its footprint.
        let placed = shape.clone() as Shape3D;
        const [sx] = model.scale;
        if (sx !== 1 && model.scale.every((v) => v === sx)) placed = placed.scale(sx) as Shape3D;
        placed = placed.rotate(-model.rotate[0], [0, 0, 0], [1, 0, 0]).rotate(-model.rotate[1], [0, 0, 0], [0, 1, 0]).rotate(-model.rotate[2], [0, 0, 0], [0, 0, 1]) as Shape3D;
        placed = placed.translate([...model.offset]) as Shape3D;
        if (part.side === 'bottom') placed = placed.rotate(180, [0, 0, 0], [1, 0, 0]) as Shape3D;
        return placed.rotate(part.angle / radians, [0, 0, 0], [0, 0, 1]).translate([part.at[0] - shift[0], part.at[1] - shift[1], z]) as Shape3D;
      }),
    );
    if (placedModels.length) {
      modelled++;
      pieces.push(...placedModels);
      continue;
    }
    const height = part.height ?? defaultPartHeight;
    const outline = part.outline.map((p) => [p[0] - shift[0], p[1] - shift[1], z] as [number, number, number]);
    try {
      pieces.push(basicFaceExtrusion(makePolygon(outline), new Vector([0, 0, part.side === 'top' ? height : -height])) as Shape3D);
    } catch {
      // An outline that does not make a face (crossing itself) is left out.
    }
  }
  return { board: solid, ...(pieces.length ? { parts: makeCompound(pieces) as unknown as Shape3D } : {}), models: modelled };
}
