import { type BodyMesh, type Vec3, vertexName } from '@core/contracts';
import type { Intersection, Object3D, Raycaster, Vector3 } from 'three/webgpu';

/** Something the user clicked in the 3D view. Faces, edges and vertices carry their persistent names. */
export type Pick =
  | { readonly kind: 'face'; readonly body: string; readonly name: string; readonly hint: Vec3; readonly planar: boolean; readonly instance?: string }
  | { readonly kind: 'edge'; readonly body: string; readonly name: string; readonly hint: Vec3; readonly instance?: string }
  | { readonly kind: 'vertex'; readonly body: string; readonly name: string; readonly hint: Vec3; readonly instance?: string }
  | { readonly kind: 'profile'; readonly sketch: string; readonly profile: string };

/** A pick on a body (not a sketch profile). */
export type TopologyPick = Exclude<Pick, { kind: 'profile' }>;

const vertexCache = new WeakMap<BodyMesh, readonly { readonly name: string; readonly point: Vec3 }[]>();

/**
 * The vertices of a body: the ends of its edges, each named by the edges that meet there, as the
 * kernel names them ({@link vertexName}).
 */
export function meshVertices(mesh: BodyMesh): readonly { readonly name: string; readonly point: Vec3 }[] {
  const cached = vertexCache.get(mesh);
  if (cached) return cached;
  const corners: { point: Vec3; edges: string[] }[] = [];
  const p = mesh.edgePositions;
  for (const edge of mesh.edges) {
    for (const index of [edge.start, edge.start + edge.count - 1]) {
      const point: Vec3 = [p[index * 3] as number, p[index * 3 + 1] as number, p[index * 3 + 2] as number];
      let corner = corners.find((c) => Math.hypot(c.point[0] - point[0], c.point[1] - point[1], c.point[2] - point[2]) < 1e-3);
      if (!corner) corners.push((corner = { point, edges: [] }));
      corner.edges.push(edge.name);
    }
  }
  const vertices = corners.map((c) => ({ name: vertexName(c.edges), point: c.point }));
  vertexCache.set(mesh, vertices);
  return vertices;
}

export type PickKind = Pick['kind'];

export const pickKey = (p: Pick): string =>
  p.kind === 'profile' ? `profile:${p.sketch}:${p.profile}` : `${p.kind}:${p.instance ?? ''}:${p.body}:${p.name}`;

/** The assembly instance an object belongs to (parts are groups marked with their instance). */
function instanceOf(object: Object3D | null): string | undefined {
  for (let o = object; o; o = o.parent) {
    const instance = (o.userData as { instance?: string }).instance;
    if (instance) return instance;
  }
  return undefined;
}

function edgeCenter(mesh: BodyMesh, start: number, count: number): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = start; i < start + count; i++) {
    x += mesh.edgePositions[i * 3] as number;
    y += mesh.edgePositions[i * 3 + 1] as number;
    z += mesh.edgePositions[i * 3 + 2] as number;
  }
  return [x / count, y / count, z / count];
}

function toPick(hit: Intersection, kinds: ReadonlySet<PickKind>): Pick | undefined {
  const data = hit.object.userData as { body?: BodyMesh; pick?: Pick };
  if (data.pick?.kind === 'profile') return kinds.has('profile') ? data.pick : undefined;
  const mesh = data.body;
  if (!mesh) return undefined;
  if ((hit.object as { isLineSegments?: boolean }).isLineSegments) {
    if (!kinds.has('edge') || hit.index === undefined) return undefined;
    const index = hit.index;
    const edge = mesh.edges.find((e) => index >= e.start && index < e.start + e.count);
    const instance = instanceOf(hit.object);
    return edge && { kind: 'edge', body: mesh.body, name: edge.name, hint: edgeCenter(mesh, edge.start, edge.count), ...(instance ? { instance } : {}) };
  }
  if (!kinds.has('face') || hit.faceIndex === undefined || hit.faceIndex === null) return undefined;
  const index = hit.faceIndex * 3;
  const face = mesh.faces.find((f) => index >= f.start && index < f.start + f.count);
  const instance = instanceOf(hit.object);
  return face && { kind: 'face', body: mesh.body, name: face.name, hint: face.center, planar: face.planar, ...(instance ? { instance } : {}) };
}

/**
 * The nearest pickable thing under the ray. Edges win over the face they bound, since a click near an
 * edge rarely means the face.
 */
export function pickAt(raycaster: Raycaster, roots: readonly Object3D[], kinds: ReadonlySet<PickKind>, keep: (point: Vector3) => boolean = () => true): Pick | undefined {
  if (kinds.size === 0) return undefined;
  const hits = raycaster.intersectObjects([...roots], true);
  let best: { pick: Pick; distance: number } | undefined;
  for (const hit of hits) {
    if (!keep(hit.point)) continue;
    const pick = toPick(hit, kinds);
    if (!pick) continue;
    const distance = pick.kind === 'edge' ? hit.distance - 1 : hit.distance;
    if (!best || distance < best.distance) best = { pick, distance };
  }
  return best?.pick;
}
