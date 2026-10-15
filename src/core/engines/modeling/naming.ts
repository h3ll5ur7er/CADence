import { baseName, centerOf, type NamedShape } from '@core/access/shape';
import type { Vec3 } from '@core/contracts';
import type { Edge, Face, Shape3D } from 'replicad';
import { sameSurface, type Surface, surfaceOf } from './surfaces';

/**
 * Generative persistent naming (docs/Architecture/Document-model.md#persistent-references).
 * A face keeps the name of the earlier face whose surface it lies on; faces no earlier face explains
 * are named by the feature that made them. Edges are named after the faces they separate.
 */

export interface NamedSurface {
  readonly surface: Surface;
  readonly name: string;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const order = (a: Vec3, b: Vec3) => round(a[0]) - round(b[0]) || round(a[1]) - round(b[1]) || round(a[2]) - round(b[2]);

/** Faces of a named shape with their surfaces, to name the faces of a shape derived from it. */
export function namedSurfaces(named: NamedShape): NamedSurface[] {
  return named.shape.faces.flatMap((face) => {
    const name = named.faces.get(face.hashCode);
    return name ? [{ surface: surfaceOf(face), name: baseName(name) }] : [];
  });
}

/** Appends ~1, ~2, ... to names used more than once, ordered by position. */
function disambiguate<T extends Face | Edge>(items: { item: T; name: string }[]): Map<number, string> {
  const groups = new Map<string, { item: T; center: Vec3 }[]>();
  for (const { item, name } of items) groups.set(name, [...(groups.get(name) ?? []), { item, center: centerOf(item) }]);
  const result = new Map<number, string>();
  for (const [name, group] of groups) {
    if (group.length === 1) {
      result.set((group[0] as { item: T }).item.hashCode, name);
      continue;
    }
    group.sort((a, b) => order(a.center, b.center)).forEach(({ item }, i) => result.set(item.hashCode, `${name}~${i + 1}`));
  }
  return result;
}

/**
 * Names a feature's result. `candidates` are earlier faces in priority order (bodies before tools);
 * `fresh` names the faces this feature created, given their surface and index among new faces.
 */
export function nameShape(
  shape: Shape3D,
  candidates: readonly NamedSurface[],
  fresh: (face: Face, surface: Surface) => string | undefined,
  featureId: string,
): NamedShape {
  const unexplained: { face: Face; surface: Surface }[] = [];
  const faceNames: { item: Face; name: string }[] = [];
  for (const face of shape.faces) {
    const surface = surfaceOf(face);
    const match = candidates.find((c) => sameSurface(c.surface, surface));
    if (match) faceNames.push({ item: face, name: match.name });
    else unexplained.push({ face, surface });
  }
  unexplained.sort((a, b) => order(centerOf(a.face), centerOf(b.face)));
  unexplained.forEach(({ face, surface }, i) => faceNames.push({ item: face, name: fresh(face, surface) ?? `f:${featureId}:new:${i + 1}` }));
  const faces = disambiguate(faceNames);

  const adjacent = new Map<number, { edge: Edge; faces: Set<string> }>();
  for (const face of shape.faces) {
    const name = faces.get(face.hashCode) as string;
    for (const edge of face.edges) {
      const entry = adjacent.get(edge.hashCode) ?? { edge, faces: new Set<string>() };
      entry.faces.add(baseName(name));
      adjacent.set(edge.hashCode, entry);
    }
  }
  const edges = disambiguate([...adjacent.values()].map(({ edge, faces: names }) => ({ item: edge, name: `e:${[...names].sort().join('|')}` })));
  return { shape, faces, edges };
}
