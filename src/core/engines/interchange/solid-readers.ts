import { adopt, type NamedShape, type ShapeAccess } from '@core/access/shape';
import type { BodyMesh } from '@core/contracts';
import { getOC, importSTEP, makeCompound, measureVolume, type Shape3D } from 'replicad';
import { read3mf, readObj, readStl, type ReadMesh } from './mesh-readers';
import { meshVolume, writeStl } from './solids';

export type MeshFormat = 'stl' | 'obj' | '3mf';

/** Meshes above this many triangles are shown and converted as meshes but not turned into solids (ADR-22). */
export const solidTriangleLimit = 100_000;

export function readMeshes(bytes: Uint8Array, format: MeshFormat): Promise<ReadMesh[]> | ReadMesh[] {
  return format === 'stl' ? readStl(bytes) : format === 'obj' ? readObj(bytes) : read3mf(bytes);
}

/** The solids of a STEP file; shells that close are made solid. */
export async function stepSolids(bytes: Uint8Array): Promise<Shape3D[]> {
  const shape = await importSTEP(new Blob([bytes as BlobPart]));
  const solids = explore(shape.wrapped, 'TopAbs_SOLID').map((s) => adopt(s) as Shape3D);
  if (solids.length) return solids;
  const shells = explore(shape.wrapped, 'TopAbs_SHELL');
  const made = shells.map((shell) => adopt(new (getOC().BRepBuilderAPI_MakeSolid)(getOC().TopoDS.Shell(shell)).Solid()) as Shape3D).filter((s) => measureVolume(s) > 1e-9);
  if (made.length) return made;
  throw new Error('The STEP file holds no solids (only surfaces or curves).');
}

/**
 * A closed triangle mesh as an OpenCascade solid: OCCT's STL reader shares the edges, coplanar
 * triangles are merged into faces, and the faces are sewn into one shell and solid. Orientation
 * follows the sign of the volume.
 */
export function meshSolid(mesh: ReadMesh): Shape3D {
  const oc = getOC();
  const file = `/mesh-${Math.random().toString(36).slice(2)}.stl`;
  oc.FS.writeFile(file, writeStl([mesh]));
  const read = new oc.TopoDS_Shell();
  const reader = new oc.StlAPI_Reader();
  try {
    if (!reader.Read(read, file)) throw new Error(`${mesh.name} could not be read as a mesh.`);
    const unify = new oc.ShapeUpgrade_UnifySameDomain(read, true, true, false);
    unify.Build();
    const builder = new oc.TopoDS_Builder();
    const shell = new oc.TopoDS_Shell();
    builder.MakeShell(shell);
    for (const face of explore(unify.Shape(), 'TopAbs_FACE')) builder.Add(shell, face);
    unify.delete();
    const made = new oc.BRepBuilderAPI_MakeSolid(shell);
    const solid = adopt(made.Solid()) as Shape3D;
    made.delete();
    if (measureVolume(solid) >= 0) return solid;
    const reversed = adopt(solid.wrapped.Reversed()) as Shape3D;
    solid.delete();
    return reversed;
  } finally {
    reader.delete();
    oc.FS.unlink(file);
  }
}

/** Every sub-shape of a type, in order (no de-duplication: files hold each face once). */
function explore(shape: Shape3D['wrapped'], type: 'TopAbs_SOLID' | 'TopAbs_SHELL' | 'TopAbs_FACE') {
  const oc = getOC();
  const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[type], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const found: Shape3D['wrapped'][] = [];
  for (; explorer.More(); explorer.Next()) found.push(explorer.Current());
  explorer.delete();
  return found;
}

/** Up to this many solids of a file become a body each; more become one body (CAD-135). */
export const maxSeparateSolids = 50;

/** Stores solids without names (the Modeling Engine names them when a feature inserts them). */
export function store(shapes: ShapeAccess, key: string, read: readonly Shape3D[]): string[] {
  // A file of many solids (a circuit board with its parts' models: 669 in one) is one body made of
  // them all: as many shapes would not fit the store, nor make a usable part (CAD-135).
  const solids = read.length > maxSeparateSolids ? [makeCompound([...read]) as unknown as Shape3D] : read;
  return solids.map((shape, i) => {
    const named: NamedShape = { shape, faces: new Map(), edges: new Map() };
    shapes.put(`${key}:${i}`, named);
    return `${key}:${i}`;
  });
}

/** What a mesh file holds, for display: flat-shaded triangles and outline edges where faces fold by more than 30°. */
export interface MeshImport {
  readonly meshes: BodyMesh[];
  readonly triangles: number;
  readonly volume: number;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Whether `readSolids` can turn it into solids (meshes up to `solidTriangleLimit` triangles). */
  readonly usableAsSolid: boolean;
}

const foldCosine = Math.cos((30 * Math.PI) / 180);

export function displayMeshes(meshes: readonly ReadMesh[], key: string): MeshImport {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  let volume = 0;
  const display = meshes.map((mesh, n): BodyMesh => {
    const count = mesh.indices.length / 3;
    triangles += count;
    volume += meshVolume(mesh.positions, mesh.indices);
    const positions = new Float32Array(count * 9);
    const normals = new Float32Array(count * 9);
    const faceNormals: [number, number, number][] = [];
    const low = [Infinity, Infinity, Infinity];
    const high = [-Infinity, -Infinity, -Infinity];
    for (let t = 0; t < count; t++) {
      const corners = [0, 1, 2].map((k) => {
        const i = (mesh.indices[t * 3 + k] as number) * 3;
        return [mesh.positions[i] as number, mesh.positions[i + 1] as number, mesh.positions[i + 2] as number];
      }) as [number[], number[], number[]];
      const [a, b, c] = corners as [[number, number, number], [number, number, number], [number, number, number]];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normal: [number, number, number] = [(u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number), (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number), (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number)];
      const length = Math.hypot(...normal) || 1;
      faceNormals.push([normal[0] / length, normal[1] / length, normal[2] / length]);
      corners.forEach((p, k) => {
        positions.set(p, t * 9 + k * 3);
        normals.set(faceNormals[t] as number[], t * 9 + k * 3);
        for (let axis = 0; axis < 3; axis++) {
          low[axis] = Math.min(low[axis] as number, p[axis] as number);
          high[axis] = Math.max(high[axis] as number, p[axis] as number);
        }
      });
    }
    // Outline: edges between triangles that fold, and edges with only one triangle (open borders).
    const sides = new Map<string, number[]>();
    for (let t = 0; t < count; t++)
      for (let k = 0; k < 3; k++) {
        const [p, q] = [mesh.indices[t * 3 + k] as number, mesh.indices[t * 3 + ((k + 1) % 3)] as number];
        const id = p < q ? `${p},${q}` : `${q},${p}`;
        sides.set(id, [...(sides.get(id) ?? []), t]);
      }
    const edgePositions: number[] = [];
    for (const [id, faces] of sides) {
      const [f, g] = faces as [number, number | undefined];
      const fold = g === undefined || faces.length > 2 || dot(faceNormals[f] as number[], faceNormals[g] as number[]) < foldCosine;
      if (!fold) continue;
      for (const i of id.split(',').map(Number)) edgePositions.push(mesh.positions[i * 3] as number, mesh.positions[i * 3 + 1] as number, mesh.positions[i * 3 + 2] as number);
    }
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis] as number, low[axis] as number);
      max[axis] = Math.max(max[axis] as number, high[axis] as number);
    }
    const center = [0, 1, 2].map((axis) => ((low[axis] as number) + (high[axis] as number)) / 2) as [number, number, number];
    return {
      body: `${key}:${n}`,
      key: `${key}:${n}`,
      positions,
      normals,
      indices: Uint32Array.from({ length: count * 3 }, (_, i) => i),
      faces: [{ name: mesh.name, start: 0, count: count * 3, planar: false, center }],
      edgePositions: Float32Array.from(edgePositions),
      edges: [{ name: 'outline', start: 0, count: edgePositions.length / 3 }],
    };
  });
  return { meshes: display, triangles, volume, min: min as [number, number, number], max: max as [number, number, number], usableAsSolid: triangles <= solidTriangleLimit };
}

const dot = (a: readonly number[], b: readonly number[]) => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);
