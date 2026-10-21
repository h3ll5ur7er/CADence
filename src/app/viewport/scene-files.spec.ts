import { glb, usdz } from '@core/utilities/scene';
import { Box3, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { USDLoader } from 'three/addons/loaders/USDLoader.js';

/** The files for viewers and augmented reality (CAD-180) open in three.js's own loaders, at real size. */
const plate = {
  name: 'Plate',
  color: '#3366cc',
  // A 60 × 30 mm triangle pair at z = 6.
  positions: new Float32Array([0, 0, 6, 60, 0, 6, 60, 30, 6, 0, 30, 6]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  edges: new Float32Array(),
};
const model = { title: 'Two plates', parts: [plate, { ...plate, name: 'Copy', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 10, 1] }] };

const meshes = (root: Object3D) => {
  const found: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) found.push(o as Mesh);
  });
  return found;
};
const size = (root: Object3D) => new Box3().setFromObject(root);

describe('scene files', () => {
  it('a glTF file loads with a mesh per part, in metres with Y up', async () => {
    const bytes = glb(model);
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '');
    expect(meshes(gltf.scene)).toHaveLength(2);
    expect(gltf.scene.children.map((n) => n.name)).toEqual(['Plate', 'Copy']);
    const box = size(gltf.scene);
    expect(box.max.x - box.min.x).toBeCloseTo(0.06);
    // Z (6 and 16 mm) became Y.
    expect([box.min.y, box.max.y].map((v) => Number(v.toFixed(4)))).toEqual([0.006, 0.016]);
    expect(box.max.z - box.min.z).toBeCloseTo(0.03);
  });

  it('a USDZ package loads with a mesh per part, in metres with Y up', () => {
    const bytes = usdz(model);
    const group = new USDLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(meshes(group)).toHaveLength(2);
    const box = size(group);
    expect(box.max.x - box.min.x).toBeCloseTo(0.06);
    expect([box.min.y, box.max.y].map((v) => Number(v.toFixed(4)))).toEqual([0.006, 0.016]);
    expect(box.max.z - box.min.z).toBeCloseTo(0.03);
  });
});
