/**
 * A small software renderer: triangle meshes drawn with a depth buffer, soft shading and dark edges,
 * orthographic from a direction. For pictures where no GPU is at hand (scripts, the command line,
 * agents). Pure TypeScript: RGBA pixels out.
 */

export type Vec3 = readonly [number, number, number];
type Matrix4 = readonly number[];

export interface RasterMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  /** Line segments (pairs of points) drawn over the faces. */
  readonly edges?: Float32Array;
  /** Where the mesh is (column-major, like three.js); absent: where it is. */
  readonly transform?: Matrix4;
  /** `#rrggbb`. */
  readonly color?: string;
}

export interface RasterOptions {
  readonly width: number;
  readonly height: number;
  /** From the model towards the viewer. */
  readonly direction: Vec3;
  /** Which way is up in the picture (roughly; it is made square to the direction). */
  readonly up: Vec3;
  /** RGBA 0–255; the default is transparent. */
  readonly background?: readonly [number, number, number, number];
}

/** The standard views by name: direction towards the viewer and up. */
export const rasterViews = {
  iso: { direction: [1, -1, 1], up: [0, 0, 1] },
  front: { direction: [0, -1, 0], up: [0, 0, 1] },
  back: { direction: [0, 1, 0], up: [0, 0, 1] },
  top: { direction: [0, 0, 1], up: [0, 1, 0] },
  bottom: { direction: [0, 0, -1], up: [0, -1, 0] },
  right: { direction: [1, 0, 0], up: [0, 0, 1] },
  left: { direction: [-1, 0, 0], up: [0, 0, 1] },
} as const satisfies Record<string, { direction: Vec3; up: Vec3 }>;

export type RasterView = keyof typeof rasterViews;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const apply = (m: Matrix4 | undefined, p: Vec3, w = 1): Vec3 =>
  m
    ? [
        (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number) * w,
        (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number) * w,
        (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number) * w,
      ]
    : p;
const rgb = (hex: string | undefined): Vec3 => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '#a9b6c2');
  return m ? [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)] : [169, 182, 194];
};

/** The meshes as RGBA pixels (`width × height × 4`), the model filling the picture with a margin. */
export function rasterize(meshes: readonly RasterMesh[], options: RasterOptions): Uint8Array {
  const { width, height } = options;
  const n = unit(options.direction);
  const right = unit(cross(options.up, n));
  const up = cross(n, right);
  const pixels = new Uint8Array(width * height * 4);
  const background = options.background ?? [0, 0, 0, 0];
  for (let i = 0; i < width * height; i++) pixels.set(background, i * 4);
  const depth = new Float32Array(width * height).fill(-Infinity);

  // Every point in view coordinates: x right, y up, z towards the viewer.
  const placed = meshes.map((mesh) => {
    const points: Vec3[] = [];
    const normals: Vec3[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const p = apply(mesh.transform, [mesh.positions[i] as number, mesh.positions[i + 1] as number, mesh.positions[i + 2] as number]);
      const q = unit(apply(mesh.transform, [mesh.normals[i] as number, mesh.normals[i + 1] as number, mesh.normals[i + 2] as number], 0));
      points.push([dot(p, right), dot(p, up), dot(p, n)]);
      normals.push([dot(q, right), dot(q, up), dot(q, n)]);
    }
    const edges: Vec3[] = [];
    for (let i = 0; mesh.edges && i < mesh.edges.length; i += 3) {
      const p = apply(mesh.transform, [mesh.edges[i] as number, mesh.edges[i + 1] as number, mesh.edges[i + 2] as number]);
      edges.push([dot(p, right), dot(p, up), dot(p, n)]);
    }
    return { mesh, points, normals, edges, color: rgb(mesh.color) };
  });
  const all = placed.flatMap((m) => m.points);
  if (!all.length) return pixels;
  const [minX, maxX, minY, maxY] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const scale = 0.88 * Math.min(width / Math.max(maxX - minX, 1e-9), height / Math.max(maxY - minY, 1e-9));
  const [cx, cy] = [(minX + maxX) / 2, (minY + maxY) / 2];
  const screen = (p: Vec3): Vec3 => [width / 2 + (p[0] - cx) * scale, height / 2 - (p[1] - cy) * scale, p[2]];
  // Light from the upper left, a little towards the viewer.
  const light = unit([-0.4, 0.6, 0.7]);

  for (const { mesh, points, normals, color } of placed) {
    const s = points.map(screen);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [ia, ib, ic] = [mesh.indices[t] as number, mesh.indices[t + 1] as number, mesh.indices[t + 2] as number];
      const [a, b, c] = [s[ia] as Vec3, s[ib] as Vec3, s[ic] as Vec3];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-12) continue;
      const [x0, x1] = [Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])))];
      const [y0, y1] = [Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])))];
      const [na, nb, nc] = [normals[ia] as Vec3, normals[ib] as Vec3, normals[ic] as Vec3];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const [px, py] = [x + 0.5, y + 0.5];
          const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
          const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * a[2] + w1 * b[2] + w2 * c[2];
          const k = y * width + x;
          if (z <= (depth[k] as number)) continue;
          depth[k] = z;
          const normal = unit([w0 * na[0] + w1 * nb[0] + w2 * nc[0], w0 * na[1] + w1 * nb[1] + w2 * nc[1], w0 * na[2] + w1 * nb[2] + w2 * nc[2]]);
          // Two-sided: faces seen from behind are lit like their front.
          const shade = 0.38 + 0.62 * Math.abs(dot(normal, light));
          pixels[k * 4] = Math.min(255, color[0] * shade);
          pixels[k * 4 + 1] = Math.min(255, color[1] * shade);
          pixels[k * 4 + 2] = Math.min(255, color[2] * shade);
          pixels[k * 4 + 3] = 255;
        }
    }
  }
  // Edges in front of (or on) the faces, a little towards the viewer so they win ties.
  const bias = 1e-3 * Math.max(maxX - minX, maxY - minY, 1);
  for (const { edges } of placed) {
    for (let e = 0; e + 1 < edges.length; e += 2) {
      const [a, b] = [screen(edges[e] as Vec3), screen(edges[e + 1] as Vec3)];
      const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const [x, y] = [Math.floor(a[0] + (b[0] - a[0]) * t), Math.floor(a[1] + (b[1] - a[1]) * t)];
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const k = y * width + x;
        const z = a[2] + (b[2] - a[2]) * t;
        if (z + bias < (depth[k] as number)) continue;
        pixels.set([40, 46, 54, 255], k * 4);
      }
    }
  }
  return pixels;
}
