import { edgesOf, facesOf } from '@core/access/shape';
import type { Vec2, Vec3 } from '@core/contracts';
import type { Edge, Face, Shape3D } from 'replicad';
import { dot3, sub3 } from './geometry';
import type { ProjectedCurve } from './modeling-engine';

/** How a view sees the model: its right (`u`), up (`v`) and towards the viewer (`n`), from `origin`. */
export interface ViewAxes {
  readonly origin: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly n: Vec3;
}

/** The longest side of the depth picture, in pixels: a 100 mm part gets 1/16 mm pixels. */
const resolution = 1600;

/**
 * Hidden lines found from the bodies' triangles (CAD-125): fast on any shape, where the kernel's exact
 * hidden-line removal can take minutes (a modelled thread seen along its axis). A depth picture of
 * the triangles decides, point by point along each edge and outline, whether it is seen. Edges and
 * the outlines of cylinders stay exact where wholly seen or hidden; other outlines come from the
 * triangles. `outlines` gives the outlines a face has exactly (cylinders); `project` an edge as curves.
 */
export function meshHiddenLines(
  shapes: readonly Shape3D[],
  axes: ViewAxes,
  project: (edge: Edge) => ProjectedCurve[],
  outlines: (face: Face) => (readonly [Vec3, Vec3])[],
): { visible: ProjectedCurve[]; hidden: ProjectedCurve[]; tolerance: number } {
  const view = (p: Vec3): Vec3 => {
    const d = sub3(p, axes.origin);
    return [dot3(d, axes.u), dot3(d, axes.v), dot3(d, axes.n)];
  };
  const meshes = shapes.map((shape) => {
    const box = shape.boundingBox;
    return shape.mesh({ tolerance: Math.max(0.005, Math.hypot(box.width, box.height, box.depth) / 3000), angularTolerance: 0.1 });
  });
  const projected = meshes.map((mesh) => {
    const points = new Float64Array(mesh.vertices.length);
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const [x, y, z] = view([mesh.vertices[i] as number, mesh.vertices[i + 1] as number, mesh.vertices[i + 2] as number]);
      points.set([x, y, z], i);
    }
    return points;
  });
  const depth = DepthPicture.of(meshes.map((m, i) => ({ points: projected[i] as Float64Array, triangles: m.triangles })));
  const visible: ProjectedCurve[] = [];
  const hidden: ProjectedCurve[] = [];
  /** Splits a curve, given as points along it (in the model), into seen and hidden runs. */
  const sort = (points: readonly Vec3[], exact?: readonly ProjectedCurve[]) => {
    const seen = points.map((p) => depth.sees(view(p)));
    if (exact && seen.every((s) => s === seen[0])) return void (seen[0] ? visible : hidden).push(...exact);
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [view(points[i - 1] as Vec3), view(points[i] as Vec3)];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) continue;
      (seen[i - 1] && seen[i] ? visible : hidden).push({ kind: 'line', start: [a[0], a[1]], end: [b[0], b[1]] });
    }
  };
  /** How many pieces to test a curve of this length in: about two pixels each. */
  const steps = (length: number) => Math.min(400, Math.max(8, Math.ceil(length / (2 * depth.pixel))));

  shapes.forEach((shape, s) => {
    const faces = facesOf(shape);
    // Seams (an edge twice in one face, where a round face closes) are not drawn, as in the exact projection.
    const seams = new Set(faces.flatMap((face) => face.edges.map((e) => e.hashCode).filter((hash, i, all) => all.indexOf(hash) !== i)));
    for (const edge of edgesOf(shape)) {
      if (seams.has(edge.hashCode)) continue;
      try {
        const n = steps(edge.length);
        sort(Array.from({ length: n + 1 }, (_, i) => point(edge, i / n)), project(edge));
      } catch {
        // A degenerate edge (the tip of a cone) has no curve to follow.
      }
    }
    const mesh = meshes[s] as (typeof meshes)[number];
    const points = projected[s] as Float64Array;
    const groups = new Map(mesh.faceGroups.map((g) => [g.faceId, g]));
    for (const face of faces) {
      if (face.geomType === 'PLANE') continue;
      if (face.geomType === 'CYLINDRE') {
        for (const [a, b] of outlines(face)) {
          const n = steps(Math.hypot(...sub3(b, a)));
          sort(Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, a[2] + ((b[2] - a[2]) * i) / n] as Vec3));
        }
        continue;
      }
      // Other round faces: their outline is where the triangles turn from facing the viewer to facing away.
      const group = groups.get(face.hashCode);
      if (!group) continue;
      const xy = (i: number): Vec2 => [points[3 * i] as number, points[3 * i + 1] as number];
      const facing = (t: number) => {
        const [a, b, c] = [xy(mesh.triangles[t] as number), xy(mesh.triangles[t + 1] as number), xy(mesh.triangles[t + 2] as number)];
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0;
      };
      const sides = new Map<string, boolean[]>();
      for (let t = group.start; t < group.start + group.count; t += 3) {
        for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
          const [a, b] = [mesh.triangles[t + i] as number, mesh.triangles[t + j] as number];
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          const list = sides.get(key) ?? [];
          list.push(facing(t));
          sides.set(key, list);
        }
      }
      const at = (i: number): Vec3 => [mesh.vertices[3 * i] as number, mesh.vertices[3 * i + 1] as number, mesh.vertices[3 * i + 2] as number];
      for (const [key, list] of sides) {
        if (list.length !== 2 || list[0] === list[1]) continue;
        const [a, b] = key.split(',').map(Number) as [number, number];
        sort([at(a), at(b)]);
      }
    }
  });
  return { visible, hidden, tolerance: 2 * depth.pixel };
}

function point(edge: Edge, t: number): Vec3 {
  const p = edge.pointAt(t);
  const tuple = p.toTuple() as Vec3;
  p.delete();
  return tuple;
}

/** The nearest depth (towards the viewer) of the triangles in each pixel of the view. */
class DepthPicture {
  private constructor(
    private readonly depths: Float32Array,
    private readonly width: number,
    private readonly height: number,
    private readonly min: Vec2,
    readonly pixel: number,
    private readonly slack: number,
  ) {}

  static of(meshes: readonly { readonly points: Float64Array; readonly triangles: readonly number[] }[]): DepthPicture {
    const [min, max] = [[Infinity, Infinity], [-Infinity, -Infinity]] as [number[], number[]];
    let [low, high] = [Infinity, -Infinity];
    for (const { points } of meshes)
      for (let i = 0; i < points.length; i += 3) {
        min[0] = Math.min(min[0] as number, points[i] as number);
        min[1] = Math.min(min[1] as number, points[i + 1] as number);
        max[0] = Math.max(max[0] as number, points[i] as number);
        max[1] = Math.max(max[1] as number, points[i + 1] as number);
        low = Math.min(low, points[i + 2] as number);
        high = Math.max(high, points[i + 2] as number);
      }
    if (!Number.isFinite(low)) return new DepthPicture(new Float32Array(1).fill(-Infinity), 1, 1, [0, 0], 1, 0);
    const pixel = Math.max((max[0] as number) - (min[0] as number), (max[1] as number) - (min[1] as number), 1e-6) / resolution;
    // A pixel's border around the picture, so points on its edge have neighbours.
    const origin: Vec2 = [(min[0] as number) - 2 * pixel, (min[1] as number) - 2 * pixel];
    const width = Math.ceil(((max[0] as number) - origin[0]) / pixel) + 3;
    const height = Math.ceil(((max[1] as number) - origin[1]) / pixel) + 3;
    const depths = new Float32Array(width * height).fill(-Infinity);
    for (const { points, triangles } of meshes) {
      for (let t = 0; t < triangles.length; t += 3) {
        const [i, j, k] = [3 * (triangles[t] as number), 3 * (triangles[t + 1] as number), 3 * (triangles[t + 2] as number)];
        const [ax, ay, az] = [((points[i] as number) - origin[0]) / pixel, ((points[i + 1] as number) - origin[1]) / pixel, points[i + 2] as number];
        const [bx, by, bz] = [((points[j] as number) - origin[0]) / pixel, ((points[j + 1] as number) - origin[1]) / pixel, points[j + 2] as number];
        const [cx, cy, cz] = [((points[k] as number) - origin[0]) / pixel, ((points[k + 1] as number) - origin[1]) / pixel, points[k + 2] as number];
        const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        if (Math.abs(area) < 1e-12) continue;
        const [x0, x1] = [Math.max(0, Math.floor(Math.min(ax, bx, cx))), Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)))];
        const [y0, y1] = [Math.max(0, Math.floor(Math.min(ay, by, cy))), Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)))];
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            // Barycentric weights of the pixel's centre; a little inside the edges too, so no cracks open between triangles.
            const [px, py] = [x + 0.5, y + 0.5];
            const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
            const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
            const z = w0 * az + w1 * bz + w2 * cz;
            const at = y * width + x;
            if (z > (depths[at] as number)) depths[at] = z;
          }
      }
    }
    return new DepthPicture(depths, width, height, origin, pixel, Math.max(3 * pixel, (high - low) * 1e-4));
  }

  /**
   * Whether a point (view x, y and depth) is seen: nothing in front of it in its pixel or a
   * neighbour. The farthest of the neighbours counts, so points on the rim of a round face, whose
   * own pixel holds the face nearer the viewer, are seen.
   */
  sees(p: Vec3): boolean {
    const [x, y] = [Math.floor((p[0] - this.min[0]) / this.pixel), Math.floor((p[1] - this.min[1]) / this.pixel)];
    let farthest = Infinity;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const [i, j] = [x + dx, y + dy];
        const depth = i >= 0 && j >= 0 && i < this.width && j < this.height ? (this.depths[j * this.width + i] as number) : -Infinity;
        farthest = Math.min(farthest, depth);
      }
    return p[2] + this.slack >= farthest;
  }
}
