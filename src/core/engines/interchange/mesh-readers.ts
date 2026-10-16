import type { TriangleMesh } from './solids';
import { descendants, parseXml, type XmlElement } from './xml';
import { readZip } from '@core/utilities/archive';

/** A mesh read from a file; positions in millimetres. */
export interface ReadMesh extends TriangleMesh {
  readonly positions: number[];
  readonly indices: number[];
}

/** Binary STL when the size matches the triangle count in the header, ASCII otherwise. */
export function readStl(bytes: Uint8Array): ReadMesh[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const binary = bytes.length >= 84 && 84 + view.getUint32(80, true) * 50 === bytes.length;
  const positions: number[] = [];
  if (binary) {
    const count = view.getUint32(80, true);
    for (let t = 0; t < count; t++) for (let k = 0; k < 9; k++) positions.push(view.getFloat32(84 + t * 50 + 12 + k * 4, true));
  } else {
    const text = new TextDecoder().decode(bytes);
    for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g)) positions.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  if (positions.length === 0 || positions.some((v) => !Number.isFinite(v))) throw new Error('The STL file holds no readable triangles.');
  return [weld({ name: 'Mesh', positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i) })];
}

/** OBJ: vertices and faces (polygons become fans); `o` and `g` start new meshes; negative indices count back. */
export function readObj(bytes: Uint8Array): ReadMesh[] {
  const text = new TextDecoder().decode(bytes);
  const vertices: number[] = [];
  const meshes: { name: string; faces: number[][] }[] = [{ name: 'Mesh', faces: [] }];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const [keyword, ...rest] = line.split(/\s+/);
    if (keyword === 'v') vertices.push(Number(rest[0]), Number(rest[1]), Number(rest[2]));
    else if (keyword === 'o' || keyword === 'g') meshes.push({ name: rest.join(' ') || 'Mesh', faces: [] });
    else if (keyword === 'f') {
      const count = vertices.length / 3;
      const face = rest.map((ref) => {
        const index = Number(ref.split('/')[0]);
        return index < 0 ? count + index : index - 1;
      });
      (meshes[meshes.length - 1] as { faces: number[][] }).faces.push(face);
    }
  }
  const result = meshes
    .filter((m) => m.faces.length)
    .map((m) => {
      const indices = m.faces.flatMap((face) => face.slice(1, -1).flatMap((v, i) => [face[0] as number, v, face[i + 2] as number]));
      return compact({ name: m.name, positions: vertices, indices });
    });
  if (result.length === 0 || vertices.some((v) => !Number.isFinite(v))) throw new Error('The OBJ file holds no readable faces.');
  return result;
}

const unitScale: Readonly<Record<string, number>> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/** 3MF: every build item, with its transform; objects made of components are flattened. */
export async function read3mf(bytes: Uint8Array): Promise<ReadMesh[]> {
  const files = await readZip(bytes);
  const path = [...files.keys()].find((name) => /^\/?3D\/.*\.model$/i.test(name));
  if (!path) throw new Error('The 3MF package holds no 3D model.');
  const model = parseXml(new TextDecoder().decode(files.get(path))).children.find((e) => e.name === 'model');
  if (!model) throw new Error('The 3MF model is empty.');
  const scale = unitScale[model.attributes['unit'] ?? 'millimeter'] ?? 1;
  const objects = new Map(descendants(model, 'object').map((o) => [o.attributes['id'] ?? '', o]));
  const meshes: ReadMesh[] = [];
  const place = (object: XmlElement, matrix: number[], name: string) => {
    const mesh = object.children.find((c) => c.name === 'mesh');
    if (mesh) {
      const positions = descendants(mesh, 'vertex').flatMap((v) => transform(matrix, [Number(v.attributes['x']), Number(v.attributes['y']), Number(v.attributes['z'])]).map((c) => c * scale));
      const indices = descendants(mesh, 'triangle').flatMap((t) => [Number(t.attributes['v1']), Number(t.attributes['v2']), Number(t.attributes['v3'])]);
      meshes.push({ name, positions, indices });
    }
    for (const component of descendants(object, 'component')) {
      const child = objects.get(component.attributes['objectid'] ?? '');
      if (child) place(child, multiply(matrix, matrixOf(component.attributes['transform'])), name);
    }
  };
  for (const item of descendants(model, 'item')) {
    const object = objects.get(item.attributes['objectid'] ?? '');
    if (object) place(object, matrixOf(item.attributes['transform']), object.attributes['name'] ?? `Object ${object.attributes['id']}`);
  }
  if (meshes.length === 0 || meshes.some((m) => m.positions.some((v) => !Number.isFinite(v)))) throw new Error('The 3MF model holds no readable meshes.');
  return meshes;
}

/** 3MF transforms are 12 numbers: the 3 × 3 rotation row by row, then the translation. */
function matrixOf(text: string | undefined): number[] {
  const values = text?.trim().split(/\s+/).map(Number);
  return values?.length === 12 ? values : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
}

const transform = (m: readonly number[], [x, y, z]: [number, number, number]): number[] => [
  x * (m[0] as number) + y * (m[3] as number) + z * (m[6] as number) + (m[9] as number),
  x * (m[1] as number) + y * (m[4] as number) + z * (m[7] as number) + (m[10] as number),
  x * (m[2] as number) + y * (m[5] as number) + z * (m[8] as number) + (m[11] as number),
];

/** `outer` applied after `inner` (row-vector convention of 3MF: p · inner · outer). */
function multiply(outer: readonly number[], inner: readonly number[]): number[] {
  const rotated = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => [0, 1, 2].reduce((s, k) => s + (inner[row * 3 + k] as number) * (outer[k * 3 + col] as number), 0)));
  return [...rotated, ...transform(outer, [inner[9] as number, inner[10] as number, inner[11] as number])];
}

/** Merges equal corners (STL repeats them per triangle) so meshes share vertices. */
function weld(mesh: ReadMesh): ReadMesh {
  const index = new Map<string, number>();
  const positions: number[] = [];
  const remap: number[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const key = `${mesh.positions[i]},${mesh.positions[i + 1]},${mesh.positions[i + 2]}`;
    let at = index.get(key);
    if (at === undefined) {
      at = positions.length / 3;
      index.set(key, at);
      positions.push(mesh.positions[i] as number, mesh.positions[i + 1] as number, mesh.positions[i + 2] as number);
    }
    remap.push(at);
  }
  return { name: mesh.name, positions, indices: mesh.indices.map((i) => remap[i] as number) };
}

/** Keeps only the vertices a mesh uses (OBJ objects share one vertex list). */
function compact(mesh: ReadMesh): ReadMesh {
  const remap = new Map<number, number>();
  const positions: number[] = [];
  const indices = mesh.indices.map((i) => {
    let at = remap.get(i);
    if (at === undefined) {
      at = positions.length / 3;
      remap.set(i, at);
      positions.push(mesh.positions[i * 3] as number, mesh.positions[i * 3 + 1] as number, mesh.positions[i * 3 + 2] as number);
    }
    return at;
  });
  return { name: mesh.name, positions, indices };
}
