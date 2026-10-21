/**
 * A model as files for 3D viewers and augmented reality (CAD-180): binary glTF (`.glb`, Android,
 * WebXR, most viewers) and USDZ (iOS Quick Look). Both hold the shown parts at real size in the
 * files' own conventions, metres with Y up, each part's transform applied and its colour a material.
 */
import { zip } from '../archive';
import type { ViewerModel, ViewerPart } from '../viewer';

/** A part as the files hold it: placed, in metres, Y up. */
interface ScenePart {
  readonly name: string;
  /** Linear RGB and opacity. */
  readonly color: readonly [number, number, number, number];
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

/** sRGB `#rrggbb` to linear RGB, as glTF and USD materials take colours. */
function linear(hex: string): [number, number, number] {
  const channel = (k: number) => {
    const c = parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(1), channel(2)];
}

/** The app's default body colour, as the HTML viewer has it. */
const bodyColor = '#9fb2bb';

/** Applies the part's transform (millimetres, Z up) and turns it into metres with Y up: (x, y, z) → (x, z, −y). */
function placed(part: ViewerPart): ScenePart {
  const m = part.transform ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const at = (k: number) => m[k] as number;
  const count = part.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [part.positions[3 * i] as number, part.positions[3 * i + 1] as number, part.positions[3 * i + 2] as number];
    const wx = at(0) * x + at(4) * y + at(8) * z + at(12);
    const wy = at(1) * x + at(5) * y + at(9) * z + at(13);
    const wz = at(2) * x + at(6) * y + at(10) * z + at(14);
    const p = [wx / 1000, wz / 1000, -wy / 1000] as const;
    positions.set(p, 3 * i);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, positions[3 * i + k] as number);
      max[k] = Math.max(max[k] as number, positions[3 * i + k] as number);
    }
    const [a, b, c] = [part.normals[3 * i] as number, part.normals[3 * i + 1] as number, part.normals[3 * i + 2] as number];
    const nx = at(0) * a + at(4) * b + at(8) * c;
    const ny = at(1) * a + at(5) * b + at(9) * c;
    const nz = at(2) * a + at(6) * b + at(10) * c;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals.set([nx / length, nz / length, -ny / length], 3 * i);
  }
  return { name: part.name, color: [...linear(part.color ?? bodyColor), part.opacity ?? 1], positions, normals, indices: part.indices, min, max };
}

const parts = (model: ViewerModel) => model.parts.filter((p) => p.indices.length >= 3).map(placed);

const pad4 = (n: number) => (n + 3) & ~3;

/** The model as one binary glTF 2.0 file: a node, a mesh and a material per part. */
export function glb(model: ViewerModel): Uint8Array {
  const shown = parts(model);
  const chunks: { bytes: Uint8Array; offset: number }[] = [];
  let length = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const view = (array: Float32Array | Uint32Array, target: number) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    chunks.push({ bytes, offset: length });
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, target });
    length = pad4(length + bytes.length);
    return bufferViews.length - 1;
  };
  const meshes = shown.map((part, i) => {
    const position = accessors.push({ bufferView: view(part.positions, 34962), componentType: 5126, count: part.positions.length / 3, type: 'VEC3', min: part.min, max: part.max }) - 1;
    const normal = accessors.push({ bufferView: view(part.normals, 34962), componentType: 5126, count: part.normals.length / 3, type: 'VEC3' }) - 1;
    const indices = accessors.push({ bufferView: view(part.indices, 34963), componentType: 5125, count: part.indices.length, type: 'SCALAR' }) - 1;
    return { name: part.name, primitives: [{ attributes: { POSITION: position, NORMAL: normal }, indices, material: i, mode: 4 }] };
  });
  const json = {
    asset: { version: '2.0', generator: 'CADence' },
    scene: 0,
    scenes: [{ name: model.title, nodes: shown.map((_, i) => i) }],
    nodes: shown.map((part, i) => ({ name: part.name, mesh: i })),
    meshes,
    materials: shown.map((part) => ({
      name: part.name,
      pbrMetallicRoughness: { baseColorFactor: part.color, metallicFactor: 0, roughnessFactor: 0.6 },
      alphaMode: part.color[3] < 1 ? 'BLEND' : 'OPAQUE',
    })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: length }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(text.length);
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + length);
  const header = new DataView(out.buffer);
  header.setUint32(0, 0x46546c67, true); // glTF
  header.setUint32(4, 2, true);
  header.setUint32(8, out.length, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true); // JSON
  out.set(text, 20);
  out.fill(0x20, 20 + text.length, 20 + jsonLength); // padded with spaces
  header.setUint32(20 + jsonLength, length, true);
  header.setUint32(24 + jsonLength, 0x004e4942, true); // BIN
  for (const chunk of chunks) out.set(chunk.bytes, 28 + jsonLength + chunk.offset);
  return out;
}

/** A USD prim name: letters, digits and underscores, not starting with a digit. */
const primName = (name: string, index: number) => `${name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_') || 'Part'}_${index + 1}`;
/** Metres to the micrometre, unit vectors to five places. */
const round = (value: number, places: number) => String(Math.round(value * 10 ** places) / 10 ** places + 0);
const tuples = (array: Float32Array, places: number) => {
  const out: string[] = [];
  for (let i = 0; i < array.length; i += 3) out.push(`(${round(array[i] as number, places)}, ${round(array[i + 1] as number, places)}, ${round(array[i + 2] as number, places)})`);
  return out.join(', ');
};

/** The model as a USD stage in text form (the `model.usda` inside a USDZ package). */
export function usda(model: ViewerModel): string {
  const shown = parts(model);
  const quote = (text: string) => JSON.stringify(text);
  const materials = shown.map(
    (part, i) => `        def Material "Material_${i + 1}"
        {
            token outputs:surface.connect = </Model/Materials/Material_${i + 1}/Surface.outputs:surface>

            def Shader "Surface"
            {
                uniform token info:id = "UsdPreviewSurface"
                color3f inputs:diffuseColor = (${part.color.slice(0, 3).map((c) => round(c, 4)).join(', ')})
                float inputs:metallic = 0
                float inputs:opacity = ${round(part.color[3], 3)}
                float inputs:roughness = 0.6
                token outputs:surface
            }
        }`,
  );
  const meshes = shown.map(
    (part, i) => `    def Mesh "${primName(part.name, i)}" (
        prepend apiSchemas = ["MaterialBindingAPI"]
        customData = { string name = ${quote(part.name)} }
    )
    {
        float3[] extent = [(${part.min.map((v) => round(v, 6)).join(', ')}), (${part.max.map((v) => round(v, 6)).join(', ')})]
        int[] faceVertexCounts = [${new Array<string>(part.indices.length / 3).fill('3').join(', ')}]
        int[] faceVertexIndices = [${[...part.indices].join(', ')}]
        rel material:binding = </Model/Materials/Material_${i + 1}>
        normal3f[] normals = [${tuples(part.normals, 5)}] (
            interpolation = "vertex"
        )
        point3f[] points = [${tuples(part.positions, 6)}]
        uniform token subdivisionScheme = "none"
    }`,
  );
  return `#usda 1.0
(
    customLayerData = {
        string creator = "CADence"
    }
    defaultPrim = "Model"
    doc = ${quote(model.title)}
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Model" (
    assetInfo = { string name = ${quote(model.title)} }
    kind = "component"
)
{
    def Scope "Materials"
    {
${materials.join('\n\n')}
    }

${meshes.join('\n\n')}
}
`;
}

/** The model as a USDZ package: its stage, uncompressed, with the data aligned to 64 bytes as the format asks. */
export function usdz(model: ViewerModel): Uint8Array {
  return zip([{ name: 'model.usda', bytes: new TextEncoder().encode(usda(model)) }], { align: 64 });
}

/** What a model can be shared as: the HTML viewer, glTF or USDZ. */
export type ViewerFormat = 'html' | 'glb' | 'usdz';

const viewerTypes: Readonly<Record<ViewerFormat, string>> = { html: 'text/html', glb: 'model/gltf-binary', usdz: 'model/vnd.usdz+zip' };

/** The model as a file of the format, named after its title. */
export async function viewerFile(model: ViewerModel, format: ViewerFormat): Promise<{ readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }> {
  // The viewer page is large and rarely made: loaded only for it.
  const bytes = format === 'html' ? new TextEncoder().encode((await import('../viewer')).viewerHtml(model)) : format === 'glb' ? glb(model) : usdz(model);
  return { name: `${model.title}.${format}`, mediaType: viewerTypes[format], bytes };
}
