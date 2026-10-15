import type { NamedShape } from '@core/access/shape';
import type { FlangeMarker, TopologyRef, Vec3 } from '@core/contracts';
import { draw, type Edge, type Face, measureArea, Plane, type Shape3D } from 'replicad';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from './geometry';
import { nameShape, namedSurfaces } from './naming';

/** A failure the user can act on. */
export class FlangeError extends Error {}

/** What an edge flange needs to know about the sheet. */
export interface SheetRules {
  readonly thickness: number;
  readonly bendRadius: number;
}

const tuple = (p: { toTuple(): number[] }) => p.toTuple() as unknown as Vec3;

/** The broad face of the sheet the edge lies on: the largest flat face next to it. */
function sheetFace(shape: Shape3D, edge: Edge): Face {
  const next = shape.faces.filter((f) => f.geomType === 'PLANE' && f.edges.some((e) => e.isSame(edge)));
  const face = next.sort((a, b) => measureArea(b) - measureArea(a))[0];
  if (!face) throw new FlangeError('Pick an edge of a flat face of the sheet.');
  return face;
}

/**
 * One flange on a straight edge of the sheet: a bend of the sheet's thickness around the bend radius,
 * turning towards the side the edge's face looks to by `angle`, then a straight piece `length` long.
 * Built from its cross-section, extruded along the edge.
 */
function flangeAlong(shape: Shape3D, edge: Edge, rules: SheetRules, length: number, angle: number): { solid: Shape3D; marker: Omit<FlangeMarker, 'feature'> } {
  if (edge.geomType !== 'LINE') throw new FlangeError('Edge flanges go on straight edges.');
  const [a, b] = [tuple(edge.startPoint), tuple(edge.endPoint)];
  const along = normalize3(sub3(b, a));
  const middle = scale3(add3(a, b), 0.5);
  const face = sheetFace(shape, edge);
  const up = normalize3(tuple(face.normalAt(face.center)));
  // Away from the sheet, in the face's plane.
  let away = normalize3(cross3(along, up));
  if (dot3(away, sub3(middle, tuple(face.center))) < 0) away = scale3(away, -1);
  const across = cross3(away, up); // the extrusion direction: local y of the section plane is `up`
  const origin = dot3(a, across) <= dot3(b, across) ? a : b;
  const { thickness: t, bendRadius: r } = rules;
  // The cross-section in (away, up): the sheet's edge spans from (0, 0) on the face down to (0, -t).
  const center: [number, number] = [0, r];
  const at = (radius: number, phi: number): [number, number] => [center[0] + radius * Math.cos(phi), center[1] + radius * Math.sin(phi)];
  const [from, to] = [-Math.PI / 2, -Math.PI / 2 + angle];
  const tangent: [number, number] = [-Math.sin(to), Math.cos(to)];
  const ahead = (p: [number, number]): [number, number] => [p[0] + tangent[0] * length, p[1] + tangent[1] * length];
  const middleAngle = (from + to) / 2;
  let pen = draw([0, 0]);
  pen = r > 1e-9 ? pen.threePointsArcTo(at(r, to), at(r, middleAngle)) : pen;
  pen = pen
    .lineTo(ahead(r > 1e-9 ? at(r, to) : [0, 0]))
    .lineTo(ahead(at(r + t, to)))
    .lineTo(at(r + t, to))
    .threePointsArcTo([0, -t], at(r + t, middleAngle));
  const solid = pen.close().sketchOnPlane(new Plane([...origin], [...away], [...across])).extrude(length3(sub3(b, a))) as Shape3D;
  return { solid, marker: { start: a, end: b, away, up, length, angle } };
}

/**
 * Edge flanges on straight edges of a sheet body, joined to it. New faces are named after the edge
 * they stand on: `bend:<edge>` for the bent, round faces and `flange:<edge>` for the flat ones.
 */
export function edgeFlanges(
  feature: string,
  named: NamedShape,
  edges: readonly { readonly ref: TopologyRef; readonly edge: Edge }[],
  rules: SheetRules,
  length: number,
  angle: number,
): { named: NamedShape; markers: FlangeMarker[] } {
  if (!edges.length) throw new FlangeError('Select the edges to put flanges on.');
  if (!(angle > 0 && angle <= Math.PI)) throw new FlangeError('The bend angle must be between 0° and 180°.');
  const built = edges.map(({ edge }) => flangeAlong(named.shape, edge, rules, length, angle));
  const shape = built.reduce((all, f) => all.fuse(f.solid), named.shape);
  const nearest = (face: Face) => {
    const c = tuple(face.center);
    const distance = ({ ref }: { ref: TopologyRef }) => (ref.hint ? length3(sub3(ref.hint, c)) : Infinity);
    return [...edges].sort((x, y) => distance(x) - distance(y))[0]?.ref.name ?? 'edge';
  };
  const result = nameShape(shape, namedSurfaces(named), (face, surface) => `f:${feature}:${surface.type === 'plane' ? 'flange' : 'bend'}:${nearest(face)}`, feature);
  return { named: result, markers: built.map((f) => ({ ...f.marker, feature })) };
}
