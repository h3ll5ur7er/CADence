import { zip } from '@core/utilities/archive';

/** A triangulated body to write: positions (xyz) and triangle indices, in millimetres. */
export interface TriangleMesh {
  readonly name: string;
  /** The name of what it is made of. */
  readonly material?: string;
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
}

type V3 = [number, number, number];

function corner(positions: ArrayLike<number>, indices: ArrayLike<number>, at: number): V3 {
  const i = (indices[at] as number) * 3;
  return [positions[i] as number, positions[i + 1] as number, positions[i + 2] as number];
}

function triangle(mesh: TriangleMesh, t: number): [V3, V3, V3] {
  return [corner(mesh.positions, mesh.indices, 3 * t), corner(mesh.positions, mesh.indices, 3 * t + 1), corner(mesh.positions, mesh.indices, 3 * t + 2)];
}

const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];

/** Binary STL: 80-byte header, triangle count, then normal + 3 vertices + attribute per triangle. */
export function writeStl(meshes: readonly TriangleMesh[]): Uint8Array {
  const count = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const view = new DataView(new ArrayBuffer(84 + count * 50));
  new TextEncoder().encodeInto('CADence binary STL, millimetres', new Uint8Array(view.buffer, 0, 80));
  view.setUint32(80, count, true);
  let at = 84;
  for (const mesh of meshes) {
    for (let t = 0; t < mesh.indices.length / 3; t++) {
      const [a, b, c] = triangle(mesh, t);
      const n = cross(minus(b, a), minus(c, a));
      const length = Math.hypot(...n) || 1;
      for (const value of [...n.map((x) => x / length), ...a, ...b, ...c]) {
        view.setFloat32(at, value, true);
        at += 4;
      }
      at += 2; // attribute byte count
    }
  }
  return new Uint8Array(view.buffer);
}

/** Wavefront OBJ: one object per body, 1-based vertex indices; a body's material by name (`usemtl`). */
export function writeObj(meshes: readonly TriangleMesh[]): Uint8Array {
  const lines = ['# CADence OBJ export, millimetres'];
  let base = 1;
  for (const mesh of meshes) {
    lines.push(`o ${mesh.name}`);
    if (mesh.material) lines.push(`usemtl ${mesh.material.replace(/\s+/g, '_')}`);
    for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${mesh.positions[i]} ${mesh.positions[i + 1]} ${mesh.positions[i + 2]}`);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      lines.push(`f ${(mesh.indices[i] as number) + base} ${(mesh.indices[i + 1] as number) + base} ${(mesh.indices[i + 2] as number) + base}`);
    }
    base += mesh.positions.length / 3;
  }
  return new TextEncoder().encode(`${lines.join('\n')}\n`);
}

const escapeXml = (text: string) => text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);

/** 3MF package: a ZIP with the content types, the relationship and one model with an object per body, each of its base material. */
export function write3mf(meshes: readonly TriangleMesh[]): Uint8Array {
  const names = [...new Set(meshes.flatMap((m) => (m.material ? [m.material] : [])))];
  const materials = names.length ? `<basematerials id="${meshes.length + 1}">${names.map((name) => `<base name="${escapeXml(name)}" displaycolor="#B4B4B4FF"/>`).join('')}</basematerials>` : '';
  const objects = meshes.map((mesh, n) => {
    const material = mesh.material ? ` pid="${meshes.length + 1}" pindex="${names.indexOf(mesh.material)}"` : '';
    const vertices: string[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) vertices.push(`<vertex x="${mesh.positions[i]}" y="${mesh.positions[i + 1]}" z="${mesh.positions[i + 2]}"/>`);
    const triangles: string[] = [];
    for (let i = 0; i < mesh.indices.length; i += 3) triangles.push(`<triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${mesh.indices[i + 2]}"/>`);
    return `<object id="${n + 1}" name="${escapeXml(mesh.name)}" type="model"${material}><mesh><vertices>${vertices.join('')}</vertices><triangles>${triangles.join('')}</triangles></mesh></object>`;
  });
  const items = meshes.map((_, n) => `<item objectid="${n + 1}"/>`).join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>${materials}${objects.join('')}</resources><build>${items}</build></model>`;
  const encode = (text: string) => new TextEncoder().encode(text);
  return zip([
    {
      name: '[Content_Types].xml',
      bytes: encode(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
    },
    {
      name: '_rels/.rels',
      bytes: encode(
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
    },
    { name: '3D/3dmodel.model', bytes: encode(model) },
  ]);
}

/** Volume enclosed by a closed, outward-oriented triangle mesh (divergence theorem); for tests. */
export function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let volume = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [corner(positions, indices, t), corner(positions, indices, t + 1), corner(positions, indices, t + 2)];
    const bc = cross(b, c);
    volume += (a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2]) / 6;
  }
  return volume;
}
