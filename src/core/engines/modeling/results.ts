import { edgesOf, facesOf } from '@core/access/shape';
import type { NamedShape } from '@core/access/shape';
import type { ThreadMarker } from '@core/contracts';
import { deserializeShape, type Shape3D } from 'replicad';

/**
 * Component results (docs/Architecture/Decisions.md#adr-11): each body's B-rep with the names of its
 * faces and edges in the kernel's topological order, which a B-rep round trip keeps, and the threads
 * on it (CAD-166).
 */
interface Snapshot {
  readonly version: 1;
  readonly bodies: readonly { readonly id: string; readonly brep: string; readonly faces: readonly string[]; readonly edges: readonly string[]; readonly threads?: readonly ThreadMarker[] }[];
}

export function snapshotOf(bodies: readonly { id: string; named: NamedShape }[]): Uint8Array {
  const snapshot: Snapshot = {
    version: 1,
    bodies: bodies.map(({ id, named }) => ({
      id,
      brep: named.shape.serialize(),
      faces: facesOf(named.shape).map((f) => named.faces.get(f.hashCode) ?? ''),
      edges: edgesOf(named.shape).map((e) => named.edges.get(e.hashCode) ?? ''),
      ...(named.threads?.length ? { threads: named.threads } : {}),
    })),
  };
  return new TextEncoder().encode(JSON.stringify(snapshot));
}

export function readSnapshot(bytes: Uint8Array): { id: string; named: () => NamedShape }[] {
  const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
  if (snapshot.version !== 1) throw new Error(`Unknown component result version ${String(snapshot.version)}.`);
  return snapshot.bodies.map((body) => ({
    id: body.id,
    named: () => {
      const shape = deserializeShape(body.brep) as Shape3D;
      const byOrder = (names: readonly string[], items: readonly { hashCode: number }[]) =>
        new Map(items.flatMap((item, i) => (names[i] ? [[item.hashCode, names[i]] as const] : [])));
      return { shape, faces: byOrder(body.faces, facesOf(shape)), edges: byOrder(body.edges, edgesOf(shape)), ...(body.threads ? { threads: body.threads } : {}) };
    },
  }));
}
