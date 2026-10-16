import { baseName, centerOf, edgesOf, facesOf, type NamedShape } from '@core/access/shape';
import type { Vec3 } from '@core/contracts';
import { type Edge, type Face, getOC, makeVertex, type Shape3D } from 'replicad';
import { liesOn, samePlaneIgnoringSide, sameSurface, type Surface, surfaceOf } from './surfaces';

/**
 * Generative persistent naming (docs/Architecture/Document-model.md#persistent-references).
 * A face keeps the name of the earlier face whose surface it lies on; faces no earlier face explains
 * are named by the feature that made them. Edges are named after the faces they separate. Faces and
 * edges a feature leaves as they were keep their names, `~n` and all, so references to them hold.
 */

export interface NamedSurface {
  readonly surface: Surface;
  readonly name: string;
  /** The earlier face, and the shape it belongs to, when the surface comes from one. */
  readonly face?: Face;
  readonly source?: NamedShape;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;
const order = (a: Vec3, b: Vec3) => round(a[0]) - round(b[0]) || round(a[1]) - round(b[1]) || round(a[2]) - round(b[2]);
const suffix = (name: string) => Number(/~(\d+)$/.exec(name)?.[1] ?? 0);

/**
 * Faces of a named shape with their surfaces, to name the faces of a shape derived from it. A body's
 * faces that the derived shape still has keep their names; a tool's names are only a stem.
 */
export function namedSurfaces(named: NamedShape, role: 'body' | 'tool' = 'body'): NamedSurface[] {
  return facesOf(named.shape).flatMap((face) => {
    const name = named.faces.get(face.hashCode);
    return name ? [{ surface: surfaceOf(face), name: baseName(name), face, ...(role === 'body' ? { source: named } : {}) }] : [];
  });
}

interface Naming<T> {
  readonly item: T;
  readonly name: string;
  /** The name it had before, kept as it is. */
  readonly kept?: string;
}

/**
 * Appends ~1, ~2, ... to names used more than once, ordered by position. Kept names stay; the others
 * take the numbers the kept ones leave free (CAD-104).
 */
function disambiguate<T extends Face | Edge>(items: readonly Naming<T>[]): Map<number, string> {
  const keptCount = new Map<string, number>();
  for (const { kept } of items) if (kept) keptCount.set(kept, (keptCount.get(kept) ?? 0) + 1);
  const groups = new Map<string, { item: T; center: Vec3; kept?: string }[]>();
  for (const { item, name, kept } of items) {
    const keep = kept && keptCount.get(kept) === 1 && baseName(kept) === name ? kept : undefined;
    groups.set(name, [...(groups.get(name) ?? []), { item, center: centerOf(item), ...(keep ? { kept: keep } : {}) }]);
  }
  const result = new Map<number, string>();
  for (const [name, group] of groups) {
    const fixed = group.filter((g) => g.kept);
    for (const g of fixed) result.set(g.item.hashCode, g.kept as string);
    const rest = group.filter((g) => !g.kept).sort((a, b) => order(a.center, b.center));
    if (rest.length === 1 && !fixed.some((g) => g.kept === name || suffix(g.kept as string) > 0)) {
      result.set((rest[0] as { item: T }).item.hashCode, name);
      continue;
    }
    const used = new Set(fixed.map((g) => suffix(g.kept as string)));
    let next = 1;
    for (const { item } of rest) {
      while (used.has(next)) next++;
      result.set(item.hashCode, `${name}~${next++}`);
    }
  }
  return result;
}

/** Whether a face lies on an earlier face: a point inside it is on that face. */
function within(face: Face, earlier: Face): boolean {
  const { uMin, uMax, vMin, vMax } = face.UVBounds;
  const inside = makeVertex(face.pointOnSurface((uMin + uMax) / 2, (vMin + vMax) / 2).toTuple());
  const tool = new (getOC().BRepExtrema_DistShapeShape)();
  try {
    tool.LoadS1(inside.wrapped);
    tool.LoadS2(earlier.wrapped);
    tool.Perform();
    return tool.IsDone() && tool.Value() < 1e-4;
  } finally {
    tool.delete();
    inside.delete();
  }
}

/** Of earlier faces on a face's surface, the one it is a piece of, when they have different names. */
function pieceOf(face: Face, matches: readonly NamedSurface[]): NamedSurface | undefined {
  if (new Set(matches.map((m) => m.name)).size < 2) return matches[0];
  return matches.find((m) => m.face && within(face, m.face)) ?? matches[0];
}

/**
 * The earlier name of a face or edge that is still the same element of the kernel (a feature left it
 * as it was), from the shapes the candidates belong to.
 */
function keptNames(candidates: readonly NamedSurface[]): (element: Face | Edge, kind: 'faces' | 'edges') => string | undefined {
  const sources = [...new Set(candidates.flatMap((c) => (c.source ? [c.source] : [])))];
  const elements = { faces: new Map<NamedShape, Map<number, (Face | Edge)[]>>(), edges: new Map<NamedShape, Map<number, (Face | Edge)[]>>() };
  const elementsOf = (source: NamedShape, kind: 'faces' | 'edges') => {
    let found = elements[kind].get(source);
    if (!found) {
      found = new Map();
      for (const element of kind === 'faces' ? facesOf(source.shape) : edgesOf(source.shape)) found.set(element.hashCode, [...(found.get(element.hashCode) ?? []), element]);
      elements[kind].set(source, found);
    }
    return found;
  };
  return (element, kind) => {
    for (const source of sources) {
      const name = source[kind].get(element.hashCode);
      // Equal hash codes are a hint; the kernel says whether it is the very same element.
      if (name && elementsOf(source, kind).get(element.hashCode)?.some((e) => e.wrapped.IsSame(element.wrapped))) return name;
    }
    return undefined;
  };
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
  const keptName = keptNames(candidates);
  const unexplained: { face: Face; surface: Surface }[] = [];
  const faceNames: Naming<Face>[] = [];
  for (const face of facesOf(shape)) {
    const kept = keptName(face, 'faces');
    if (kept) {
      faceNames.push({ item: face, name: baseName(kept), kept });
      continue;
    }
    const surface = surfaceOf(face);
    // A hole's walls face the other way to the tool faces that cut them: same plane, other side.
    // A trimmed freeform face lies on the same surface as the face it came from: that face's probes lie on it.
    const on = (test: (c: NamedSurface) => boolean) => {
      const matches = candidates.filter(test);
      return matches.length ? pieceOf(face, matches) : undefined;
    };
    const match =
      on((c) => sameSurface(c.surface, surface)) ??
      on((c) => samePlaneIgnoringSide(c.surface, surface)) ??
      (surface.type === 'other' ? on((c) => c.surface.type === 'other' && liesOn(face, c.surface.probes)) : undefined);
    if (match) faceNames.push({ item: face, name: match.name });
    else unexplained.push({ face, surface });
  }
  unexplained.sort((a, b) => order(centerOf(a.face), centerOf(b.face)));
  unexplained.forEach(({ face, surface }, i) => faceNames.push({ item: face, name: fresh(face, surface) ?? `f:${featureId}:new:${i + 1}` }));
  const faces = disambiguate(faceNames);

  const adjacent = new Map<number, { edge: Edge; faces: Set<string> }>();
  for (const face of facesOf(shape)) {
    const name = faces.get(face.hashCode) as string;
    for (const edge of face.edges) {
      const entry = adjacent.get(edge.hashCode) ?? { edge, faces: new Set<string>() };
      entry.faces.add(baseName(name));
      adjacent.set(edge.hashCode, entry);
    }
  }
  const edgeNames = [...adjacent.values()].map(({ edge, faces: names }): Naming<Edge> => {
    const kept = keptName(edge, 'edges');
    return { item: edge, name: `e:${[...names].sort().join('|')}`, ...(kept ? { kept } : {}) };
  });
  return { shape, faces, edges: disambiguate(edgeNames) };
}
