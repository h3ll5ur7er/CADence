import { facesOf } from '@core/access/shape';
import type { NamedShape } from '@core/access/shape';
import { type CornerRelief, flangeCorners, type FlangeMarker, type FlangePiece, type HemStyle, type TopologyRef, type Vec3 } from '@core/contracts';
import { flangeSection, type FlangeSection } from '@core/utilities/math';
import { draw, drawCircle, type Edge, type Face, measureArea, Plane, type Shape3D } from 'replicad';
import type { PathPiece } from './modeling-engine';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from './geometry';
import { nameShape, namedSurfaces } from './naming';

/** A failure the user can act on. */
export class FlangeError extends Error {}

/** What a flange needs to know about the sheet. */
export interface SheetRules {
  readonly thickness: number;
  readonly bendRadius: number;
}

/** Corner reliefs: their shape and size, and the flanges earlier features put on the sheet (whose corners with new ones get them too). */
export interface Corners {
  readonly relief?: { readonly shape: CornerRelief; readonly size: number };
  readonly earlier?: readonly FlangeMarker[];
}

interface PickedEdge {
  readonly ref: TopologyRef;
  readonly edge: Edge;
}

const tuple = (p: { toTuple(): number[] }) => p.toTuple() as unknown as Vec3;

/** The broad face of the sheet the edge lies on: the largest flat face next to it. */
function sheetFace(shape: Shape3D, edge: Edge): Face {
  const next = facesOf(shape).filter((f) => f.geomType === 'PLANE' && f.edges.some((e) => e.isSame(edge)));
  const face = next.sort((a, b) => measureArea(b) - measureArea(a))[0];
  if (!face) throw new FlangeError('Pick an edge of a flat face of the sheet.');
  return face;
}

/** Where a straight edge of the sheet is: its ends, its direction, away from the sheet in the face's plane, and out of the face. */
interface EdgeFrame {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly along: Vec3;
  readonly away: Vec3;
  readonly up: Vec3;
  readonly length: number;
}

function edgeFrame(shape: Shape3D, edge: Edge): EdgeFrame {
  if (edge.geomType !== 'LINE') throw new FlangeError('Flanges go on straight edges.');
  const [start, end] = [tuple(edge.startPoint), tuple(edge.endPoint)];
  const along = normalize3(sub3(end, start));
  const middle = scale3(add3(start, end), 0.5);
  const face = sheetFace(shape, edge);
  const up = normalize3(tuple(face.normalAt(face.center)));
  // Away from the sheet, in the face's plane.
  let away = normalize3(cross3(along, up));
  if (dot3(away, sub3(middle, tuple(face.center))) < 0) away = scale3(away, -1);
  return { start, end, along, away, up, length: length3(sub3(end, start)) };
}

/**
 * One flange along an edge: its section (bends and straight pieces) extruded along the edge. Mitred
 * ends reach `miter` millimetres past the edge's ends per millimetre away from it: the section is
 * extruded further, then trimmed by the miter planes.
 */
function flangeSolid(frame: EdgeFrame, section: FlangeSection, thickness: number, miter?: { readonly start: number; readonly end: number }): Shape3D {
  const points = [...section.top, ...section.bottom].flatMap((p) => (p.kind === 'arc' ? [p.start, p.mid, p.end] : [p.start, p.end]));
  const [wMin, wMax] = [Math.min(0, ...points.map((p) => p[0])), Math.max(0, ...points.map((p) => p[0]))];
  const height = Math.max(...points.map((p) => Math.abs(p[1]))) + thickness + 1;
  // The ends' planes: u = ks·w at the start and u = length + ke·w at the end, w being the distance away from the edge.
  const [ks, ke] = [-(miter?.start ?? 0), miter?.end ?? 0];
  const reach = Math.max(Math.abs(wMin), Math.abs(wMax)) * Math.max(Math.abs(ks), Math.abs(ke)) + (miter ? 1 : 0);
  // Along the edge from its start: [lo, hi], longer than the edge where it is mitred.
  const [lo, hi] = [-reach, frame.length + reach];
  const across = cross3(frame.away, frame.up); // the extrusion direction: local y of the section plane is `up`
  const origin = add3(frame.start, scale3(frame.along, dot3(across, frame.along) > 0 ? lo : hi));
  let pen = draw([0, 0]);
  for (const piece of section.top) pen = piece.kind === 'line' ? pen.lineTo([...piece.end]) : pen.threePointsArcTo([...piece.end], [...piece.mid]);
  const last = section.bottom.at(-1);
  pen = pen.lineTo(last ? [...last.end] : [0, -thickness]);
  for (const piece of [...section.bottom].reverse()) pen = piece.kind === 'line' ? pen.lineTo([...piece.start]) : pen.threePointsArcTo([...piece.start], [...piece.mid]);
  const solid = pen.close().sketchOnPlane(new Plane([...origin], [...frame.away], [...across])).extrude(hi - lo) as Shape3D;
  if (!miter) return solid;
  // What a mitred flange keeps: between the planes through its edge's ends, turned by the miter.
  const [w0, w1] = [wMin - 1, wMax + 1];
  for (const w of [w0, w1]) if (!(ks * w < frame.length + ke * w - 1e-6)) throw new FlangeError('The miter flange is too deep for the corners of its edges.');
  const normal = cross3(frame.along, frame.away); // local y of this plane is `away`
  const keep = draw([ks * w0, w0])
    .lineTo([frame.length + ke * w0, w0])
    .lineTo([frame.length + ke * w1, w1])
    .lineTo([ks * w1, w1])
    .close()
    .sketchOnPlane(new Plane([...sub3(frame.start, scale3(normal, height))], [...frame.along], [...normal]))
    .extrude(2 * height) as Shape3D;
  return solid.intersect(keep);
}

/**
 * Adds flanges to a sheet body: each piece's solid joined, then the corner reliefs cut. New faces are
 * named after the edge they stand on: `bend:<edge>` for the round ones, `flange:<edge>` for the flat
 * ones, and `relief:<n>` for the relief cuts, by corner.
 */
function addFlanges(
  feature: string,
  named: NamedShape,
  items: readonly { readonly ref: TopologyRef; readonly frame: EdgeFrame; readonly pieces: readonly FlangePiece[]; readonly miter?: { readonly start: number; readonly end: number } }[],
  rules: SheetRules,
  corners: Corners,
): { named: NamedShape; markers: FlangeMarker[] } {
  const t = rules.thickness;
  const markers = items.map(({ frame, pieces, miter }): FlangeMarker => ({ feature, start: frame.start, end: frame.end, away: frame.away, up: frame.up, pieces, ...(miter ? { miter } : {}) }));
  let shape = items.reduce((all, item) => all.fuse(flangeSolid(item.frame, flangeSection(item.pieces, t), t, item.miter)), named.shape);
  // Reliefs where a new flange meets another at a corner of the face they stand on.
  const earlier = corners.earlier ?? [];
  const all = [...earlier, ...markers];
  const relief = corners.relief;
  const cut = relief && relief.shape !== 'tear' ? flangeCorners(all).filter((c) => c.second >= earlier.length) : [];
  for (const corner of cut) {
    const [m, n] = [all[corner.first], all[corner.second]] as [FlangeMarker, FlangeMarker];
    shape = shape.cut(reliefTool(corner.at, m, n, relief?.shape ?? 'round', relief?.size ?? 0, t, rules.bendRadius));
  }
  const nearest = (face: Face) => {
    const c = tuple(face.center);
    const distance = ({ ref }: { ref: TopologyRef }) => (ref.hint ? length3(sub3(ref.hint, c)) : Infinity);
    return [...items].sort((x, y) => distance(x) - distance(y))[0]?.ref.name ?? 'edge';
  };
  const reliefOf = (face: Face) => {
    const c = tuple(face.center);
    const index = cut.findIndex((corner) => length3(sub3(corner.at, c)) <= (relief?.size ?? 0) + t);
    return index < 0 ? undefined : index + 1;
  };
  const result = nameShape(
    shape,
    namedSurfaces(named),
    (face, surface) => {
      const corner = reliefOf(face);
      return corner ? `f:${feature}:relief:${corner}` : `f:${feature}:${surface.type === 'plane' ? 'flange' : 'bend'}:${nearest(face)}`;
    },
    feature,
  );
  return { named: result, markers };
}

/**
 * The solid a corner relief cuts: a round of the size's diameter or a square of its side, centred
 * where the two flanges' edges meet, through the sheet and the start of both bends.
 */
function reliefTool(at: Vec3, m: FlangeMarker, n: FlangeMarker, shape: CornerRelief, size: number, thickness: number, bendRadius: number): Shape3D {
  const up = m.up;
  const depth = thickness + 0.01;
  const base = sub3(at, scale3(up, depth));
  const plane = new Plane([...base], [...m.away], [...up]);
  const height = depth + bendRadius + 0.01;
  if (shape === 'round') return drawCircle(size / 2).sketchOnPlane(plane).extrude(height) as Shape3D;
  // A square along the two flanges' directions away from the sheet (in the plane's coordinates).
  const h = size / 2;
  const b: [number, number] = [dot3(n.away, m.away), dot3(n.away, cross3(up, m.away))];
  const corner = (sa: number, sb: number): [number, number] => [sa * h + sb * h * b[0], sb * h * b[1]];
  return draw(corner(1, 1)).lineTo(corner(-1, 1)).lineTo(corner(-1, -1)).lineTo(corner(1, -1)).close().sketchOnPlane(plane).extrude(height) as Shape3D;
}

/** Edge flanges on straight edges of a sheet body (the base flange or earlier flanges), joined to it. */
export function edgeFlanges(
  feature: string,
  named: NamedShape,
  edges: readonly PickedEdge[],
  rules: SheetRules,
  length: number,
  angle: number,
  corners: Corners = {},
): { named: NamedShape; markers: FlangeMarker[] } {
  if (!edges.length) throw new FlangeError('Select the edges to put flanges on.');
  if (!(angle > 0 && angle <= Math.PI)) throw new FlangeError('The bend angle must be between 0° and 180°.');
  const pieces = [{ angle, radius: rules.bendRadius, length }];
  return addFlanges(feature, named, edges.map(({ ref, edge }) => ({ ref, frame: edgeFrame(named.shape, edge), pieces })), rules, corners);
}

/**
 * The bend of a hem: half a turn round half the gap (closed: none), or for a teardrop, round a loop of
 * the gap's diameter until the straight piece's end comes back down to the sheet: to a tenth of the
 * thickness above it, so the two never touch along a line.
 */
export function hemPiece(style: HemStyle, gap: number, length: number, thickness: number): FlangePiece {
  if (style === 'closed') return { angle: Math.PI, radius: 0, length };
  if (!(gap > 0)) throw new FlangeError('An open or teardrop hem needs a gap.');
  const r = gap / 2;
  if (style === 'open') return { angle: Math.PI, radius: r, length };
  // The inside surface's end above the clearance: r(1 − cos θ) + L sin θ − t/10, falling from 2r at θ = π.
  const height = (angle: number) => r * (1 - Math.cos(angle)) + length * Math.sin(angle) - thickness / 10;
  if (!(height((3 * Math.PI) / 2) < 0)) throw new FlangeError('A teardrop hem needs a length longer than half its gap.');
  let [low, high] = [Math.PI, (3 * Math.PI) / 2];
  for (let i = 0; i < 60; i++) {
    const middle = (low + high) / 2;
    if (height(middle) > 0) low = middle;
    else high = middle;
  }
  return { angle: low, radius: r, length };
}

/** Hems on straight edges of a sheet body: the edge folded back over the face it is on. */
export function hems(
  feature: string,
  named: NamedShape,
  edges: readonly PickedEdge[],
  rules: SheetRules,
  style: HemStyle,
  gap: number,
  length: number,
  corners: Corners = {},
): { named: NamedShape; markers: FlangeMarker[] } {
  if (!edges.length) throw new FlangeError('Select the edges to hem.');
  const pieces = [hemPiece(style, gap, length, rules.thickness)];
  return addFlanges(feature, named, edges.map(({ ref, edge }) => ({ ref, frame: edgeFrame(named.shape, edge), pieces })), rules, corners);
}

/**
 * The bends and straight pieces of a miter flange's profile (straight lines in a plane square to the
 * edge), seen along the edge: from the end nearest the edge, each line a straight piece after a bend
 * by the angle it turns (the first from the sheet, towards the face the edge is on).
 */
export function profilePieces(profile: readonly PathPiece[], frame: EdgeFrame, bendRadius: number): FlangePiece[] {
  if (!profile.length || profile.some((p) => p.kind !== 'line')) throw new FlangeError('A miter flange profile is drawn with straight lines.');
  const lines = profile as readonly Extract<PathPiece, { kind: 'line' }>[];
  const flat = (p: Vec3): [number, number] => [dot3(sub3(p, frame.start), frame.away), dot3(sub3(p, frame.start), frame.up)];
  let points = [lines[0]?.start as Vec3, ...lines.map((l) => l.end)].map(flat);
  const distance = (p: [number, number]) => Math.hypot(p[0], p[1]);
  if (distance(points.at(-1) as [number, number]) < distance(points[0] as [number, number])) points = points.reverse();
  const pieces: FlangePiece[] = [];
  let before: [number, number] = [1, 0];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as [number, number], points[i] as [number, number]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    const direction: [number, number] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const angle = Math.atan2(before[0] * direction[1] - before[1] * direction[0], before[0] * direction[0] + before[1] * direction[1]);
    if (!pieces.length && !(angle > 1e-9)) throw new FlangeError('The profile must leave the sheet towards the face its edges are on.');
    if (Math.abs(angle) > Math.PI - 1e-9) throw new FlangeError('The profile cannot turn back on itself.');
    pieces.push({ angle, radius: bendRadius, length });
    before = direction;
  }
  return pieces;
}

/**
 * A miter flange: the profile's section along a chain of connected straight edges of one face, each
 * piece trimmed where two edges meet by the plane halfway between them.
 */
export function miterFlange(
  feature: string,
  named: NamedShape,
  edges: readonly PickedEdge[],
  rules: SheetRules,
  profile: readonly PathPiece[],
  profileNormal: Vec3,
  corners: Corners = {},
): { named: NamedShape; markers: FlangeMarker[] } {
  if (!edges.length) throw new FlangeError('Select the chain of edges for the miter flange.');
  const frames = edges.map(({ edge }) => edgeFrame(named.shape, edge));
  const first = frames[0] as EdgeFrame;
  if (frames.some((f) => dot3(f.up, first.up) < 1 - 1e-6 || Math.abs(dot3(sub3(f.start, first.start), first.up)) > 1e-6)) {
    throw new FlangeError('The edges of a miter flange lie on one face.');
  }
  const square = frames.find((f) => Math.abs(dot3(f.along, normalize3(profileNormal))) > 1 - 1e-6);
  if (!square) throw new FlangeError('Draw the profile on a plane square to one of the edges.');
  const pieces = profilePieces(profile, square, rules.bendRadius);
  const near = (a: Vec3, b: Vec3) => length3(sub3(a, b)) < 1e-6;
  // Where an end's plane (halfway between two edges that meet) lies along the edge, per millimetre away from it.
  const miterAt = (i: number, at: Vec3): number => {
    const frame = frames[i] as EdgeFrame;
    const others = frames.filter((f, j) => j !== i && (near(f.start, at) || near(f.end, at)));
    if (others.length > 1) throw new FlangeError('The edges of a miter flange form one chain, without branches.');
    const other = others[0];
    if (!other) return 0;
    const between = add3(frame.away, other.away);
    if (length3(between) < 1e-6) throw new FlangeError('Two edges of the chain turn back on each other.');
    return dot3(between, frame.along) / dot3(between, frame.away);
  };
  const items = edges.map(({ ref }, i) => {
    const frame = frames[i] as EdgeFrame;
    return { ref, frame, pieces, miter: { start: -miterAt(i, frame.start), end: miterAt(i, frame.end) } };
  });
  for (const [i, frame] of frames.entries()) {
    const linked = frames.some((f, j) => j !== i && [f.start, f.end].some((p) => near(p, frame.start) || near(p, frame.end)));
    if (frames.length > 1 && !linked) throw new FlangeError('The edges of a miter flange must connect end to end.');
  }
  return addFlanges(feature, named, items, rules, corners);
}
