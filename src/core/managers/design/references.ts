import type { BodyMesh, TimelineItem, TopologyRef, Vec3 } from '@core/contracts';

/** A face, edge or vertex a timeline item refers to that the bodies before it no longer have, and the nearest of the same kind that they do. */
export interface BrokenReference {
  readonly ref: TopologyRef;
  /** Nearest first (to where the lost one was picked); none when it was picked without a position. */
  readonly candidates: readonly { readonly ref: TopologyRef; readonly distance: number }[];
}

const isRef = (value: unknown): value is TopologyRef => {
  const v = value as Partial<TopologyRef> | null;
  return !!v && typeof v === 'object' && (v.kind === 'face' || v.kind === 'edge' || v.kind === 'vertex') && typeof v.body === 'string' && typeof v.name === 'string';
};
const same = (a: TopologyRef, b: TopologyRef) => a.kind === b.kind && a.body === b.body && a.name === b.name;

/** Every face, edge and vertex the item refers to, once each. */
export function topologyRefs(item: TimelineItem): TopologyRef[] {
  const found: TopologyRef[] = [];
  const visit = (value: unknown): void => {
    if (isRef(value)) {
      if (!found.some((r) => same(r, value))) found.push(value);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(item);
  return found;
}

/** The item with `from` replaced by `to` wherever it refers to it. */
export function replaceReference(item: TimelineItem, from: TopologyRef, to: TopologyRef): TimelineItem {
  const replace = (value: unknown): unknown => {
    if (isRef(value)) return same(value, from) ? to : value;
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replace(v)]));
    return value;
  };
  return replace(item) as TimelineItem;
}

/** The references of `item` that `meshes` (the bodies before it) do not have, with candidates to replace them. */
export function brokenReferences(item: TimelineItem, meshes: readonly BodyMesh[], limit = 5): BrokenReference[] {
  const exists = (ref: TopologyRef): boolean => {
    const mesh = meshes.find((m) => m.body === ref.body);
    if (!mesh) return false;
    if (ref.kind === 'face') return mesh.faces.some((f) => f.name === ref.name);
    if (ref.kind === 'edge') return mesh.edges.some((e) => e.name === ref.name);
    // A vertex is where its edges meet: it is there while they all are.
    const edges = ref.name.replace(/^v:/, '').split('&');
    return edges.every((name) => mesh.edges.some((e) => e.name === name));
  };
  return topologyRefs(item)
    .filter((ref) => !exists(ref))
    .map((ref) => ({ ref, candidates: ref.hint && ref.kind !== 'vertex' ? nearest(ref.kind, ref.hint, meshes).slice(0, limit) : [] }));
}

/** Faces or edges of all bodies by their distance from `point`. */
function nearest(kind: 'face' | 'edge', point: Vec3, meshes: readonly BodyMesh[]): { ref: TopologyRef; distance: number }[] {
  const at = (buffer: Float32Array, i: number): Vec3 => [buffer[3 * i] as number, buffer[3 * i + 1] as number, buffer[3 * i + 2] as number];
  const found = meshes.flatMap((mesh): { ref: TopologyRef; distance: number }[] => {
    if (kind === 'face') {
      return mesh.faces.map((face) => {
        let distance = Infinity;
        for (let i = face.start; i < face.start + face.count; i += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => at(mesh.positions, mesh.indices[i + k] as number)) as [Vec3, Vec3, Vec3];
          distance = Math.min(distance, toTriangle(point, a, b, c));
        }
        return { ref: { kind, body: mesh.body, name: face.name, hint: face.center }, distance };
      });
    }
    return mesh.edges.map((edge) => {
      let distance = Infinity;
      let closest: Vec3 = point;
      for (let i = edge.start; i < edge.start + edge.count; i += 2) {
        const [a, b] = [at(mesh.edgePositions, i), at(mesh.edgePositions, i + 1)];
        const p = onSegment(point, a, b);
        const d = length(sub(point, p));
        if (d < distance) [distance, closest] = [d, p];
      }
      return { ref: { kind, body: mesh.body, name: edge.name, hint: closest }, distance };
    });
  });
  return found.filter((c) => Number.isFinite(c.distance)).sort((a, b) => a.distance - b.distance);
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3) => Math.sqrt(dot(a, a));

/** The point of segment ab nearest to p. */
function onSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/** Distance from p to triangle abc: to the plane where p projects inside, else to the nearest side. */
function toTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const [ab, ac, ap] = [sub(b, a), sub(c, a), sub(p, a)];
  const n: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const nn = dot(n, n);
  if (nn > 1e-12) {
    // Barycentric coordinates of the projection.
    const [d00, d01, d11, d20, d21] = [dot(ab, ab), dot(ab, ac), dot(ac, ac), dot(ap, ab), dot(ap, ac)];
    const denominator = d00 * d11 - d01 * d01;
    const v = (d11 * d20 - d01 * d21) / denominator;
    const w = (d00 * d21 - d01 * d20) / denominator;
    if (v >= 0 && w >= 0 && v + w <= 1) return Math.abs(dot(ap, n)) / Math.sqrt(nn);
  }
  return Math.min(...[[a, b], [b, c], [c, a]].map(([s, e]) => length(sub(p, onSegment(p, s as Vec3, e as Vec3)))));
}
