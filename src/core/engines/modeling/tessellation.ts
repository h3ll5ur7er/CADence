import type { NamedShape } from '@core/access/shape';
import type { BodyMesh, MeshEdge, MeshFace, Vec3 } from '@core/contracts';
import type { BodyState } from './modeling-engine';

/** Triangles and edge lines of a body, with the persistent names of its faces and edges. */
export function tessellate(state: BodyState, named: NamedShape): BodyMesh {
  const { shape } = named;
  const box = shape.boundingBox;
  const size = Math.hypot(box.width, box.height, box.depth);
  const tolerance = Math.max(0.01, size / 2000);
  const mesh = shape.mesh({ tolerance, angularTolerance: 0.2 });
  const faceByHash = new Map(shape.faces.map((f) => [f.hashCode, f]));
  const faces: MeshFace[] = mesh.faceGroups.map((group) => {
    const face = faceByHash.get(group.faceId);
    return {
      name: named.faces.get(group.faceId) ?? `unnamed-${group.faceId}`,
      start: group.start,
      count: group.count,
      planar: face?.geomType === 'PLANE',
      center: (face?.center.toTuple() ?? [0, 0, 0]) as Vec3,
    };
  });
  const lines = shape.meshEdges({ tolerance, angularTolerance: 0.2 });
  const edges: MeshEdge[] = lines.edgeGroups.map((group) => ({
    name: named.edges.get(group.edgeId) ?? `unnamed-${group.edgeId}`,
    start: group.start,
    count: group.count,
  }));
  return {
    body: state.id,
    key: state.key,
    positions: Float32Array.from(mesh.vertices),
    normals: Float32Array.from(mesh.normals),
    indices: Uint32Array.from(mesh.triangles),
    faces,
    edgePositions: Float32Array.from(lines.lines),
    edges,
  };
}
