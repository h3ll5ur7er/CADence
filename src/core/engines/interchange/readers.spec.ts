import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { read3mf, readObj, readStl } from './mesh-readers';
import { meshVolume, write3mf, writeObj, writeStl } from './solids';
import { parseXml } from './xml';
import { crc32 } from './zip';

/** A 10 mm cube centred on the origin, outward triangles. */
const cube = () => {
  const positions = [-5, -5, -5, 5, -5, -5, 5, 5, -5, -5, 5, -5, -5, -5, 5, 5, -5, 5, 5, 5, 5, -5, 5, 5];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { name: 'Cube', positions, indices };
};
const text = (s: string) => new TextEncoder().encode(s);

/** A ZIP whose entries are deflated and whose local headers defer sizes to data descriptors, like many real files. */
function deflatedZip(files: Record<string, string>): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = text(content);
    const data = new Uint8Array(deflateRawSync(raw));
    const nameBytes = text(name);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(6, 0x0008, true); // sizes follow in a data descriptor
    header.setUint16(8, 8, true);
    header.setUint16(26, nameBytes.length, true);
    const descriptor = new DataView(new ArrayBuffer(16));
    descriptor.setUint32(0, 0x08074b50, true);
    descriptor.setUint32(4, crc32(raw), true);
    descriptor.setUint32(8, data.length, true);
    descriptor.setUint32(12, raw.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, 8, true);
    entry.setUint32(16, crc32(raw), true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    for (const part of [new Uint8Array(header.buffer), nameBytes, data, new Uint8Array(descriptor.buffer)]) {
      local.push(part);
      offset += part.length;
    }
    central.push(new Uint8Array(entry.buffer), nameBytes);
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

describe('XML reader', () => {
  it('reads nested elements and attributes, ignoring namespaces, comments and declarations', () => {
    const doc = parseXml(`<?xml version="1.0"?><!-- note --><svg:svg xmlns:svg="x" width='10mm'><g id="a &amp; b"><path d="M 0 0"/></g></svg:svg>`);
    const svg = doc.children[0];
    expect(svg?.name).toBe('svg');
    expect(svg?.attributes['width']).toBe('10mm');
    expect(svg?.children[0]?.attributes['id']).toBe('a & b');
    expect(svg?.children[0]?.children[0]).toMatchObject({ name: 'path', attributes: { d: 'M 0 0' } });
  });
});

describe('mesh readers', () => {
  it('reads binary STL and welds the repeated corners', () => {
    const [mesh] = readStl(writeStl([cube()]));
    expect(mesh?.indices.length).toBe(36);
    expect(mesh?.positions.length).toBe(8 * 3);
    expect(meshVolume(mesh?.positions ?? [], mesh?.indices ?? [])).toBeCloseTo(1000, 3);
  });

  it('reads ASCII STL', () => {
    const ascii = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const [mesh] = readStl(text(ascii));
    expect(mesh?.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(mesh?.indices).toEqual([0, 1, 2]);
  });

  it('reads OBJ objects, polygons and negative indices', () => {
    const obj = `v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
o Square
f 1/1 2/2 3/3 4/4
o Triangle
v 5 5 5
f -1 -2 -3`;
    const [square, triangle] = readObj(text(obj));
    expect(square).toMatchObject({ name: 'Square', indices: [0, 1, 2, 0, 2, 3] });
    expect(triangle?.name).toBe('Triangle');
    expect(triangle?.positions).toEqual([5, 5, 5, 0, 1, 0, 1, 1, 0]);
    const [again] = readObj(writeObj([cube()]));
    expect(meshVolume(again?.positions ?? [], again?.indices ?? [])).toBeCloseTo(1000, 3);
  });

  it('reads 3MF packages it wrote', async () => {
    const [mesh] = await read3mf(write3mf([cube()]));
    expect(mesh?.name).toBe('Cube');
    expect(meshVolume(mesh?.positions ?? [], mesh?.indices ?? [])).toBeCloseTo(1000, 3);
  });

  it('reads deflated 3MF with units, components and build transforms', async () => {
    const { positions, indices } = cube();
    const vertices = Array.from({ length: 8 }, (_, i) => `<vertex x="${positions[i * 3]}" y="${positions[i * 3 + 1]}" z="${positions[i * 3 + 2]}"/>`).join('');
    const triangles = Array.from({ length: 12 }, (_, i) => `<triangle v1="${indices[i * 3]}" v2="${indices[i * 3 + 1]}" v3="${indices[i * 3 + 2]}"/>`).join('');
    const model = `<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
      <object id="1" type="model"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>
      <object id="2" name="Pair"><components><component objectid="1"/><component objectid="1" transform="1 0 0 0 1 0 0 0 1 20 0 0"/></components></object>
    </resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 100"/></build></model>`;
    const meshes = await read3mf(deflatedZip({ '[Content_Types].xml': '<Types/>', '3D/3dmodel.model': model }));
    expect(meshes.map((m) => m.name)).toEqual(['Pair', 'Pair']);
    // Centimetres: each cube is 100 mm wide, the second 200 mm to the right, both 1000 mm up.
    expect(meshVolume(meshes[0]?.positions ?? [], meshes[0]?.indices ?? [])).toBeCloseTo(1e6, 0);
    expect(Math.min(...(meshes[1]?.positions.filter((_, i) => i % 3 === 0) ?? []))).toBeCloseTo(150);
    expect(Math.min(...(meshes[1]?.positions.filter((_, i) => i % 3 === 2) ?? []))).toBeCloseTo(950);
  });

  it('refuses files without geometry', async () => {
    expect(() => readStl(text('solid empty\nendsolid'))).toThrow('no readable triangles');
    expect(() => readObj(text('# nothing'))).toThrow('no readable faces');
    await expect(read3mf(text('not a zip'))).rejects.toThrow('not a ZIP');
  });
});
