import { describe, expect, it } from 'vitest';
import { readZip } from '../archive';
import { glb, usda, usdz } from './index';

const triangle = {
  name: 'Plate 1',
  positions: new Float32Array([0, 0, 0, 100, 0, 0, 0, 50, 20]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2]),
  edges: new Float32Array(),
};
const model = {
  title: 'Bracket',
  parts: [triangle, { ...triangle, name: 'Lid "top"', color: '#ff0000', opacity: 0.5, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1] }],
};

function chunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    asset: { version: string };
    nodes: { name: string; mesh: number }[];
    materials: { alphaMode: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[];
    accessors: { bufferView: number; count: number; min?: number[]; max?: number[] }[];
    bufferViews: { byteOffset: number; byteLength: number }[];
    buffers: { byteLength: number }[];
  };
  const binLength = view.getUint32(20 + jsonLength, true);
  const bin = bytes.subarray(28 + jsonLength, 28 + jsonLength + binLength);
  return { view, jsonLength, json, binLength, bin, binType: view.getUint32(24 + jsonLength, true) };
}

describe('glb', () => {
  const bytes = glb(model);
  const { view, jsonLength, json, binLength, bin, binType } = chunks(bytes);

  it('is a binary glTF 2.0 file with a JSON and a binary chunk', () => {
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(bytes.length);
    expect(jsonLength % 4).toBe(0);
    expect(binType).toBe(0x004e4942);
    expect(binLength).toBe(json.buffers[0]?.byteLength);
    expect(json.asset.version).toBe('2.0');
    expect(json.nodes.map((n) => n.name)).toEqual(['Plate 1', 'Lid "top"']);
  });

  it('holds the parts at real size in metres with Y up, each placed by its transform', () => {
    const position = (accessor: number) => {
      const a = json.accessors[accessor] as { bufferView: number; count: number };
      const v = json.bufferViews[a.bufferView] as { byteOffset: number };
      return [...new Float32Array(bin.slice(v.byteOffset, v.byteOffset + a.count * 12).buffer)];
    };
    // (x, y, z) mm → (x, z, −y) m
    expect(position(0).map((v) => Number(v.toFixed(6)))).toEqual([0, 0, 0, 0.1, 0, 0, 0, 0.02, -0.05]);
    expect(position(3)[0]).toBeCloseTo(0.01);
    expect(json.accessors[0]?.min).toEqual([0, 0, expect.closeTo(-0.05)]);
    expect(json.accessors[0]?.max).toEqual([expect.closeTo(0.1), expect.closeTo(0.02), 0]);
    // Normals turn with the axes: Z up becomes Y up.
    expect(position(1).slice(0, 3)).toEqual([0, 1, -0]);
  });

  it('gives each part its colour (linear) and see-through parts blending', () => {
    expect(json.materials[0]?.alphaMode).toBe('OPAQUE');
    expect(json.materials[1]?.alphaMode).toBe('BLEND');
    expect(json.materials[1]?.pbrMetallicRoughness.baseColorFactor).toEqual([1, 0, 0, 0.5]);
  });
});

describe('usdz', () => {
  it('is a stage in metres with Y up, a mesh and a material per part', () => {
    const text = usda(model);
    expect(text).toMatch(/^#usda 1\.0/);
    expect(text).toContain('metersPerUnit = 1');
    expect(text).toContain('upAxis = "Y"');
    expect(text).toContain('def Mesh "Plate_1_1"');
    expect(text).toContain('def Mesh "Lid__top__2"');
    expect(text).toContain('customData = { string name = "Lid \\"top\\"" }');
    expect(text).toContain('point3f[] points = [(0, 0, 0), (0.1, 0, 0), (0, 0.02, -0.05)]');
    expect(text).toContain('float inputs:opacity = 0.5');
    expect(text).toContain('rel material:binding = </Model/Materials/Material_2>');
  });

  it('is an uncompressed zip whose file data starts at a multiple of 64 bytes', async () => {
    const bytes = usdz(model);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // stored
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    expect(start % 64).toBe(0);
    const files = await readZip(bytes);
    expect(new TextDecoder().decode(files.get('model.usda'))).toBe(usda(model));
  });
});
