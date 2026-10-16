import { edgesOf, facesOf } from './topology';
import { type TopologyRef, type Vec3, vertexName } from '@core/contracts';
import { type Edge, type Face, makeVertex, type Vertex } from 'replicad';
import type { NamedShape } from './index';

/** A name without the "~2" that tells split pieces apart. */
export const baseName = (name: string): string => name.replace(/~\d+$/, '');

export const centerOf = (shape: Face | Edge): Vec3 => shape.boundingBox.center as Vec3;

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Points closer than this are one vertex (mm). */
const sameVertex = 1e-4;

/** Faces or edges with their names and positions. */
function elementsOf(named: NamedShape, kind: 'face' | 'edge'): { element: Face | Edge; name: string; center: Vec3 }[] {
  const elements: (Face | Edge)[] = kind === 'face' ? facesOf(named.shape) : edgesOf(named.shape);
  const names = kind === 'face' ? named.faces : named.edges;
  return elements.flatMap((element) => {
    const name = names.get(element.hashCode);
    return name ? [{ element, name, center: centerOf(element) }] : [];
  });
}

/** The ends of the named edges, each named by the edges that meet there. */
export function verticesOf(named: NamedShape): { point: Vec3; name: string }[] {
  const corners: { point: Vec3; edges: string[] }[] = [];
  for (const edge of edgesOf(named.shape)) {
    const name = named.edges.get(edge.hashCode);
    if (!name) continue;
    for (const end of [edge.startPoint, edge.endPoint]) {
      const point = end.toTuple() as Vec3;
      end.delete();
      let corner = corners.find((c) => distance(c.point, point) < sameVertex);
      if (!corner) corners.push((corner = { point, edges: [] }));
      corner.edges.push(name);
    }
  }
  return corners.map((c) => ({ point: c.point, name: vertexName(c.edges) }));
}

/** A vertex by name, else the one where it was picked; edits that move it lose it. */
function findVertex(named: NamedShape, ref: TopologyRef): Vertex | undefined {
  const vertices = verticesOf(named);
  const hint = ref.hint;
  const found = vertices.find((v) => v.name === ref.name) ?? (hint ? vertices.find((v) => distance(v.point, hint) < sameVertex) : undefined);
  return found && makeVertex([...found.point]);
}

/**
 * Finds the face, edge or vertex a reference names (docs/Architecture/Document-model.md#persistent-references):
 * by exact name, then among the split pieces of that name, nearest to where it was picked.
 * A name that is gone resolves to nothing; it is never re-bound to another element.
 */
export function find(named: NamedShape, ref: TopologyRef): Face | Edge | Vertex | undefined {
  if (ref.kind === 'vertex') return findVertex(named, ref);
  const elements = elementsOf(named, ref.kind);
  const exact = elements.find((e) => e.name === ref.name);
  if (exact) return exact.element;
  const pieces = elements.filter((e) => baseName(e.name) === baseName(ref.name));
  const hint = ref.hint;
  if (hint) pieces.sort((a, b) => distance(a.center, hint) - distance(b.center, hint));
  return pieces[0]?.element;
}
