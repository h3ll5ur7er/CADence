import type { TopologyRef, Vec3 } from '@core/contracts';
import type { Edge, Face } from 'replicad';
import type { NamedShape } from './index';

/** A name without the "~2" that tells split pieces apart. */
export const baseName = (name: string): string => name.replace(/~\d+$/, '');

export const centerOf = (shape: Face | Edge): Vec3 => shape.boundingBox.center as Vec3;

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Faces or edges with their names and positions. */
function elementsOf(named: NamedShape, kind: TopologyRef['kind']): { element: Face | Edge; name: string; center: Vec3 }[] {
  const elements: (Face | Edge)[] = kind === 'face' ? named.shape.faces : named.shape.edges;
  const names = kind === 'face' ? named.faces : named.edges;
  return elements.flatMap((element) => {
    const name = names.get(element.hashCode);
    return name ? [{ element, name, center: centerOf(element) }] : [];
  });
}

/**
 * Finds the face or edge a reference names (docs/Architecture/Document-model.md#persistent-references):
 * by exact name, then among the split pieces of that name, nearest to where it was picked.
 * A name that is gone resolves to nothing; it is never re-bound to another element.
 */
export function find(named: NamedShape, ref: TopologyRef): Face | Edge | undefined {
  const elements = elementsOf(named, ref.kind);
  const exact = elements.find((e) => e.name === ref.name);
  if (exact) return exact.element;
  const pieces = elements.filter((e) => baseName(e.name) === baseName(ref.name));
  const hint = ref.hint;
  if (hint) pieces.sort((a, b) => distance(a.center, hint) - distance(b.center, hint));
  return pieces[0]?.element;
}
