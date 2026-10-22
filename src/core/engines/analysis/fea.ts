import type { Vec3 } from '@core/contracts';
import { SolverError, solveStiffness } from './fea-solver';

/**
 * Linear static finite element analysis (CAD-93), pure TypeScript. The body is filled with a grid of
 * cubes (kept where their middle is inside), each split into six tetrahedra the same way so they fit
 * together; nodes on the boundary are moved onto the true surface. Elements are 10-node quadratic
 * tetrahedra, which bend well even when coarse. The stiffness system is solved in `fea-solver.ts`.
 */

/** A body's surface as triangles, each face's triangles named (like a display mesh). */
export interface FeaSurface {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly faces: readonly { readonly name: string; readonly start: number; readonly count: number }[];
}

export interface FeaInput {
  readonly surface: FeaSurface;
  /** Whether a point is inside the body. */
  readonly inside: (p: Vec3) => boolean;
  readonly box: { readonly min: Vec3; readonly max: Vec3 };
  /** Element size (mm); absent: from the body's size. */
  readonly size?: number | undefined;
  /** Young's modulus (MPa) and Poisson's ratio. */
  readonly modulus: number;
  readonly poisson: number;
  /** Names of the faces held fixed. */
  readonly fixed: ReadonlySet<string>;
  /**
   * Forces in N, moments in N·mm: a force spread over a face, a pressure, a force and a moment at a
   * point carried to a face rigidly (remote), a moment on a face.
   */
  readonly loads: readonly ({ readonly face: string } & (
    | { readonly kind: 'force'; readonly force: number; readonly direction: Vec3 }
    | { readonly kind: 'pressure'; readonly pressure: number }
    | { readonly kind: 'remote'; readonly point: Vec3; readonly force: Vec3; readonly moment?: Vec3 }
    | { readonly kind: 'moment'; readonly moment: Vec3 }
  ))[];
  /** The body's own weight (CAD-191): density in kg/mm³ along gravity in m/s². */
  readonly density?: number;
  readonly gravity?: Vec3;
}

export interface FeaOutput {
  readonly positions: Float32Array;
  readonly displacement: Float32Array;
  /** Von Mises stress at each node (MPa). */
  readonly stress: Float32Array;
  readonly elements: number;
  /** The boundary as triangles of nodes, facing out (each quadratic face as four), to draw the results on. */
  readonly surface: Uint32Array;
}

export class FeaError extends Error {}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

/** The six tetrahedra of a cube (corners numbered 0–7 as below), all around the 0–6 diagonal. */
const kuhn = [
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
  [0, 5, 1, 6],
] as const;
const cubeCorners: readonly Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
/** The edges of a quadratic tetrahedron, by corner, in the order of its mid-edge nodes 4–9. */
const tetEdges = [
  [0, 1],
  [1, 2],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 3],
] as const;
/** The faces of a tetrahedron: three corners and the mid-edge nodes between them, and the corner opposite. */
const tetFaces = [
  { corners: [1, 2, 3], mids: [5, 9, 8], opposite: 0 },
  { corners: [0, 2, 3], mids: [6, 9, 7], opposite: 1 },
  { corners: [0, 1, 3], mids: [4, 8, 7], opposite: 2 },
  { corners: [0, 1, 2], mids: [4, 5, 6], opposite: 3 },
] as const;

/** Triangles of the surface in a grid of cells, for nearest-point queries. */
class SurfaceIndex {
  private readonly cells = new Map<string, number[]>();

  constructor(
    private readonly surface: FeaSurface,
    private readonly cell: number,
  ) {
    const { indices } = surface;
    for (let t = 0; t < indices.length / 3; t++) {
      const [a, b, c] = this.triangle(t);
      const lo = [0, 1, 2].map((k) => Math.floor(Math.min(a[k] as number, b[k] as number, c[k] as number) / cell));
      const hi = [0, 1, 2].map((k) => Math.floor(Math.max(a[k] as number, b[k] as number, c[k] as number) / cell));
      for (let x = lo[0] as number; x <= (hi[0] as number); x++)
        for (let y = lo[1] as number; y <= (hi[1] as number); y++)
          for (let z = lo[2] as number; z <= (hi[2] as number); z++) {
            const key = `${x},${y},${z}`;
            const list = this.cells.get(key);
            if (list) list.push(t);
            else this.cells.set(key, [t]);
          }
    }
  }

  triangle(t: number): [Vec3, Vec3, Vec3] {
    const p = this.surface.positions;
    const at = (i: number): Vec3 => [p[i * 3] as number, p[i * 3 + 1] as number, p[i * 3 + 2] as number];
    const idx = this.surface.indices;
    return [at(idx[t * 3] as number), at(idx[t * 3 + 1] as number), at(idx[t * 3 + 2] as number)];
  }

  /** The nearest point of the surface within `reach`, and the triangle it is on. */
  nearest(p: Vec3, reach: number): { point: Vec3; triangle: number; distance: number } | undefined {
    const range = Math.ceil(reach / this.cell);
    const [cx, cy, cz] = p.map((v) => Math.floor(v / this.cell)) as [number, number, number];
    let best: { point: Vec3; triangle: number; distance: number } | undefined;
    const seen = new Set<number>();
    for (let x = cx - range; x <= cx + range; x++)
      for (let y = cy - range; y <= cy + range; y++)
        for (let z = cz - range; z <= cz + range; z++)
          for (const t of this.cells.get(`${x},${y},${z}`) ?? []) {
            if (seen.has(t)) continue;
            seen.add(t);
            const q = closestOnTriangle(p, ...this.triangle(t));
            const d = length(sub(p, q));
            if (d <= reach && (!best || d < best.distance)) best = { point: q, triangle: t, distance: d };
          }
    return best;
  }
}

/** The point of triangle abc nearest to p (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v];
  }
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w];
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
}

const signedVolume = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => dot(sub(b, a), cross(sub(c, a), sub(d, a))) / 6;

// Four-point Gauss rule on the tetrahedron, in volume coordinates; weights of 1/24 add up to its volume 1/6.
const ga = 0.5854101966249685;
const gb = 0.1381966011250105;
const gauss: readonly (readonly [number, number, number, number])[] = [
  [ga, gb, gb, gb],
  [gb, ga, gb, gb],
  [gb, gb, ga, gb],
  [gb, gb, gb, ga],
];

/** Derivatives of the ten shape functions with respect to the volume coordinates L1–L4, at L. */
function shapeDerivatives(L: readonly number[]): number[][] {
  // dN/dL[m] for each node n: corners L(2L−1), mid-edges 4·La·Lb.
  const d = Array.from({ length: 10 }, () => [0, 0, 0, 0]);
  for (let i = 0; i < 4; i++) (d[i] as number[])[i] = 4 * (L[i] as number) - 1;
  tetEdges.forEach(([a, b], k) => {
    (d[4 + k] as number[])[a] = 4 * (L[b] as number);
    (d[4 + k] as number[])[b] = 4 * (L[a] as number);
  });
  return d;
}

/**
 * Global derivatives (x, y, z) of the shape functions and the Jacobian's determinant at L, for an
 * element with nodes `x` (10 × 3). Volume coordinates: L1 = 1 − ξ − η − ζ, L2 = ξ, L3 = η, L4 = ζ.
 */
function gradients(x: readonly Vec3[], L: readonly number[]): { grad: Vec3[]; det: number } {
  const dL = shapeDerivatives(L);
  // dN/dξ_k = dN/dL_{k+1} − dN/dL_1.
  const dXi = dL.map((d) => [(d[1] as number) - (d[0] as number), (d[2] as number) - (d[0] as number), (d[3] as number) - (d[0] as number)] as Vec3);
  const J = [0, 1, 2].map((i) => [0, 1, 2].map((k) => x.reduce((s, p, n) => s + (p[i] as number) * ((dXi[n] as Vec3)[k] as number), 0)));
  const [j0, j1, j2] = J as [number[], number[], number[]];
  const det = (j0[0] as number) * ((j1[1] as number) * (j2[2] as number) - (j1[2] as number) * (j2[1] as number)) - (j0[1] as number) * ((j1[0] as number) * (j2[2] as number) - (j1[2] as number) * (j2[0] as number)) + (j0[2] as number) * ((j1[0] as number) * (j2[1] as number) - (j1[1] as number) * (j2[0] as number));
  // grad_x N = J^−T grad_ξ N, with J[i][k] = ∂x_i/∂ξ_k.
  const inv = [
    [(j1[1] as number) * (j2[2] as number) - (j1[2] as number) * (j2[1] as number), (j0[2] as number) * (j2[1] as number) - (j0[1] as number) * (j2[2] as number), (j0[1] as number) * (j1[2] as number) - (j0[2] as number) * (j1[1] as number)],
    [(j1[2] as number) * (j2[0] as number) - (j1[0] as number) * (j2[2] as number), (j0[0] as number) * (j2[2] as number) - (j0[2] as number) * (j2[0] as number), (j0[2] as number) * (j1[0] as number) - (j0[0] as number) * (j1[2] as number)],
    [(j1[0] as number) * (j2[1] as number) - (j1[1] as number) * (j2[0] as number), (j0[1] as number) * (j2[0] as number) - (j0[0] as number) * (j2[1] as number), (j0[0] as number) * (j1[1] as number) - (j0[1] as number) * (j1[0] as number)],
  ].map((row) => row.map((v) => v / det));
  // (J^−1)[k][i]: ∂ξ_k/∂x_i; grad_x N_i = Σ_k ∂N/∂ξ_k ∂ξ_k/∂x_i.
  const grad = dXi.map((g) => [0, 1, 2].map((i) => (g[0] as number) * ((inv[0] as number[])[i] as number) + (g[1] as number) * ((inv[1] as number[])[i] as number) + (g[2] as number) * ((inv[2] as number[])[i] as number)) as unknown as Vec3);
  return { grad, det };
}

/** The isotropic elasticity matrix (6 × 6, engineering shear strains xy, yz, zx). */
function elasticity(E: number, nu: number): number[][] {
  const lambda = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  const mu = E / (2 * (1 + nu));
  const D = Array.from({ length: 6 }, () => [0, 0, 0, 0, 0, 0]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) (D[i] as number[])[j] = lambda + (i === j ? 2 * mu : 0);
  for (let i = 3; i < 6; i++) (D[i] as number[])[i] = mu;
  return D;
}

/** The strain-displacement matrix rows for node gradients g (6 × 30). */
function strainMatrix(grad: readonly Vec3[]): Float64Array {
  const B = new Float64Array(6 * 30);
  grad.forEach(([dx, dy, dz], n) => {
    const c = n * 3;
    B[0 * 30 + c] = dx;
    B[1 * 30 + c + 1] = dy;
    B[2 * 30 + c + 2] = dz;
    B[3 * 30 + c] = dy;
    B[3 * 30 + c + 1] = dx;
    B[4 * 30 + c + 1] = dz;
    B[4 * 30 + c + 2] = dy;
    B[5 * 30 + c] = dz;
    B[5 * 30 + c + 2] = dx;
  });
  return B;
}

export function solveFea(input: FeaInput): FeaOutput {
  const { box } = input;
  const extent = sub(box.max, box.min);
  if (extent.some((v) => !(v > 0))) throw new FeaError('The body has no volume.');
  // About 800 cubes (quadratic elements need few), and at least two across the thinnest direction.
  const auto = Math.min(Math.cbrt((extent[0] * extent[1] * extent[2]) / 800), Math.min(...extent) / 2);
  const size = input.size && input.size > 0 ? input.size : auto;
  const counts = extent.map((v) => Math.max(1, Math.round(v / size))) as [number, number, number];
  const step = extent.map((v, k) => v / (counts[k] as number)) as unknown as Vec3;
  if (counts[0] * counts[1] * counts[2] > 400_000) throw new FeaError('The elements are too small for the part: choose a larger size.');

  // Cubes whose middle is inside, and their corners (compactly numbered).
  const gridIndex = (i: number, j: number, k: number) => i + (counts[0] + 1) * (j + (counts[1] + 1) * k);
  const cornerOf = new Map<number, number>();
  const corners: Vec3[] = [];
  const tets: number[][] = [];
  for (let k = 0; k < counts[2]; k++)
    for (let j = 0; j < counts[1]; j++)
      for (let i = 0; i < counts[0]; i++) {
        const middle: Vec3 = [box.min[0] + (i + 0.5) * step[0], box.min[1] + (j + 0.5) * step[1], box.min[2] + (k + 0.5) * step[2]];
        if (!input.inside(middle)) continue;
        const ids = cubeCorners.map(([a, b, c]) => {
          const g = gridIndex(i + a, j + b, k + c);
          let id = cornerOf.get(g);
          if (id === undefined) {
            id = corners.length;
            cornerOf.set(g, id);
            corners.push([box.min[0] + (i + a) * step[0], box.min[1] + (j + b) * step[1], box.min[2] + (k + c) * step[2]]);
          }
          return id;
        });
        for (const tet of kuhn) tets.push(tet.map((c) => ids[c] as number));
      }
  if (!tets.length) throw new FeaError('The elements are too large for the part: choose a smaller size.');

  // Boundary faces (on one tetrahedron only), and the corners on them moved onto the surface.
  const faceKey = (a: number, b: number, c: number) => [a, b, c].sort((x, y) => x - y).join(',');
  const faceCount = new Map<string, number>();
  for (const tet of tets) for (const f of tetFaces) {
    const key = faceKey(tet[f.corners[0]] as number, tet[f.corners[1]] as number, tet[f.corners[2]] as number);
    faceCount.set(key, (faceCount.get(key) ?? 0) + 1);
  }
  const boundaryCorners = new Set<number>();
  for (const tet of tets) for (const f of tetFaces) {
    const ids = f.corners.map((c) => tet[c] as number) as [number, number, number];
    if (faceCount.get(faceKey(...ids)) === 1) ids.forEach((id) => boundaryCorners.add(id));
  }
  const reach = Math.max(...step) * 0.75;
  const index = new SurfaceIndex(input.surface, Math.max(...step));
  const original = corners.map((c) => c);
  for (const id of boundaryCorners) {
    const near = index.nearest(corners[id] as Vec3, reach);
    if (near) corners[id] = near.point;
  }
  // A move that turns a tetrahedron inside out (or flat) is taken back.
  for (let pass = 0; pass < 2; pass++)
    tets.forEach((tet) => {
      const before = signedVolume(...(tet.map((id) => original[id]) as [Vec3, Vec3, Vec3, Vec3]));
      const after = signedVolume(...(tet.map((id) => corners[id]) as [Vec3, Vec3, Vec3, Vec3]));
      if (after * Math.sign(before) < Math.abs(before) * 0.05) for (const id of tet) corners[id] = original[id] as Vec3;
    });
  // Every tetrahedron positively oriented.
  for (const tet of tets) {
    if (signedVolume(...(tet.map((id) => corners[id]) as [Vec3, Vec3, Vec3, Vec3])) < 0) [tet[1], tet[2]] = [tet[2] as number, tet[1] as number];
  }

  // Mid-edge nodes (shared between neighbours), after the corners.
  const midOf = new Map<string, number>();
  const nodes: Vec3[] = [...corners];
  const elements: number[][] = tets.map((tet) => [
    ...tet,
    ...tetEdges.map(([a, b]) => {
      const [p, q] = [tet[a] as number, tet[b] as number];
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      let id = midOf.get(key);
      if (id === undefined) {
        id = nodes.length;
        midOf.set(key, id);
        const [x, y] = [corners[p] as Vec3, corners[q] as Vec3];
        nodes.push([(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2]);
      }
      return id;
    }),
  ]);
  const count = nodes.length;

  // Stiffness pattern: 3 × 3 blocks between nodes of a common element (block CSR).
  const neighbours: Set<number>[] = Array.from({ length: count }, () => new Set<number>());
  for (const e of elements) for (const a of e) for (const b of e) (neighbours[a] as Set<number>).add(b);
  const rowStart = new Int32Array(count + 1);
  neighbours.forEach((set, a) => (rowStart[a + 1] = (rowStart[a] as number) + set.size));
  const columns = new Int32Array(rowStart[count] as number);
  neighbours.forEach((set, a) => columns.set([...set].sort((x, y) => x - y), rowStart[a] as number));
  const values = new Float64Array((rowStart[count] as number) * 9);
  const blockOf = (a: number, b: number) => {
    let [lo, hi] = [rowStart[a] as number, (rowStart[a + 1] as number) - 1];
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      const c = columns[m] as number;
      if (c === b) return m;
      if (c < b) lo = m + 1;
      else hi = m - 1;
    }
    throw new Error('Missing stiffness block');
  };

  const D = elasticity(input.modulus, input.poisson);
  const volumes: number[] = [];
  for (const e of elements) {
    const x = e.map((id) => nodes[id] as Vec3);
    const Ke = new Float64Array(30 * 30);
    let volume = 0;
    for (const L of gauss) {
      const { grad, det } = gradients(x, L);
      if (!(det > 0)) throw new FeaError('The mesh has a flat element: choose another size.');
      const B = strainMatrix(grad);
      // DB (6 × 30), then Bᵀ(DB) det w.
      const DB = new Float64Array(6 * 30);
      for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) {
        const d = (D[i] as number[])[k] as number;
        if (d === 0) continue;
        for (let c = 0; c < 30; c++) DB[i * 30 + c] = (DB[i * 30 + c] as number) + d * (B[k * 30 + c] as number);
      }
      const weight = det / 24;
      volume += weight;
      for (let r = 0; r < 30; r++) for (let i = 0; i < 6; i++) {
        const b = B[i * 30 + r] as number;
        if (b === 0) continue;
        for (let c = 0; c < 30; c++) Ke[r * 30 + c] = (Ke[r * 30 + c] as number) + b * (DB[i * 30 + c] as number) * weight;
      }
    }
    volumes.push(volume);
    for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) {
      const block = blockOf(e[a] as number, e[b] as number) * 9;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) values[block + i * 3 + j] = (values[block + i * 3 + j] as number) + (Ke[(a * 3 + i) * 30 + b * 3 + j] as number);
    }
  }

  // Boundary faces: which CAD face each lies on, its six nodes, area and outward normal.
  const faceName = (triangle: number) => input.surface.faces.find((f) => triangle * 3 >= f.start && triangle * 3 < f.start + f.count)?.name;
  const forces = new Float64Array(count * 3);
  const fixed = new Uint8Array(count);
  const loadArea = new Map<string, number>();
  const boundary: { nodes: number[]; area: number; normal: Vec3; name: string | undefined }[] = [];
  const surface: number[] = [];
  for (const e of elements)
    for (const f of tetFaces) {
      const ids = f.corners.map((c) => e[c] as number) as [number, number, number];
      if (faceCount.get(faceKey(...ids)) !== 1) continue;
      const [a, b, c] = ids.map((id) => nodes[id] as Vec3) as [Vec3, Vec3, Vec3];
      let normal = cross(sub(b, a), sub(c, a));
      const area = length(normal) / 2;
      if (area < 1e-12) continue;
      normal = normal.map((v) => v / (2 * area)) as unknown as Vec3;
      const inward = dot(normal, sub(nodes[e[f.opposite] as number] as Vec3, a)) > 0;
      if (inward) normal = normal.map((v) => -v) as unknown as Vec3;
      // Corners c0 c1 c2 and mid-edge nodes m01 m12 m02, as four triangles turned to face out.
      const [c0, c1, c2] = ids;
      const [m01, m12, m02] = f.mids.map((m) => e[m] as number) as [number, number, number];
      for (const t of [[c0, m01, m02], [m01, c1, m12], [m02, m12, c2], [m01, m12, m02]]) surface.push(...(inward ? [t[0], t[2], t[1]] : t) as number[]);
      const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
      const near = index.nearest(centroid, reach * 2);
      const name = near ? faceName(near.triangle) : undefined;
      boundary.push({ nodes: [...ids, ...f.mids.map((m) => e[m] as number)], area, normal, name });
      if (name) loadArea.set(name, (loadArea.get(name) ?? 0) + area);
    }
  for (const face of boundary) {
    if (!face.name) continue;
    if (input.fixed.has(face.name)) for (const id of face.nodes) fixed[id] = 1;
    for (const load of input.loads) {
      if (load.face !== face.name || load.kind === 'remote' || load.kind === 'moment') continue;
      // Uniform traction on a 6-node triangle: a third of it at each mid-edge node, none at the corners.
      const traction: Vec3 =
        load.kind === 'pressure'
          ? (face.normal.map((v) => -v * load.pressure) as unknown as Vec3)
          : (load.direction.map((v) => (v / (length(load.direction) || 1)) * (load.force / (loadArea.get(face.name ?? '') ?? 1))) as unknown as Vec3);
      for (const id of face.nodes.slice(3)) for (let k = 0; k < 3; k++) forces[id * 3 + k] = (forces[id * 3 + k] as number) + ((traction[k] as number) * face.area) / 3;
    }
  }
  // Remote loads and moments (CAD-191): spread over the face's nodes as a rigid connection would.
  for (const load of input.loads) {
    if (load.kind !== 'remote' && load.kind !== 'moment') continue;
    const shares = new Map<number, number>();
    for (const face of boundary) if (face.name === load.face) for (const id of face.nodes.slice(3)) shares.set(id, (shares.get(id) ?? 0) + face.area / 3);
    if (!shares.size) continue;
    const total = [...shares.values()].reduce((a, b) => a + b, 0);
    const centre = [0, 1, 2].map((k) => [...shares].reduce((sum, [id, w]) => sum + w * ((nodes[id] as Vec3)[k] as number), 0) / total) as unknown as Vec3;
    const force: Vec3 = load.kind === 'remote' ? load.force : [0, 0, 0];
    const lever = load.kind === 'remote' ? sub(load.point, centre) : ([0, 0, 0] as Vec3);
    const moment = add3(load.kind === 'remote' ? (load.moment ?? [0, 0, 0]) : load.moment, cross(lever, force));
    // The nodes turn with ω about the centre: J ω = M, with J the shares' polar moments.
    const J = [0, 1, 2].map(() => [0, 0, 0]);
    for (const [id, w] of shares) {
      const r = sub(nodes[id] as Vec3, centre);
      const rr = dot(r, r);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) (J[i] as number[])[j] = ((J[i] as number[])[j] as number) + w * ((i === j ? rr : 0) - (r[i] as number) * (r[j] as number));
    }
    const omega = solve3(J, moment);
    for (const [id, w] of shares) {
      const turn = cross(omega, sub(nodes[id] as Vec3, centre));
      for (let k = 0; k < 3; k++) forces[id * 3 + k] = (forces[id * 3 + k] as number) + ((force[k] as number) * w) / total + w * (turn[k] as number);
    }
  }
  // The body's weight: a 10-node tetrahedron takes −1/20 of its weight at each corner and 1/5 at each mid-edge node.
  if (input.density && input.gravity) {
    elements.forEach((e, n) => {
      const weight = (volumes[n] as number) * (input.density as number);
      e.forEach((id, i) => {
        const share = i < 4 ? -1 / 20 : 1 / 5;
        for (let k = 0; k < 3; k++) forces[id * 3 + k] = (forces[id * 3 + k] as number) + weight * share * ((input.gravity as Vec3)[k] as number);
      });
    });
  }
  if (!fixed.some((f) => f === 1)) throw new FeaError('Hold at least one face fixed.');

  let displacement: Float64Array;
  try {
    displacement = solveStiffness({ rowStart, columns, values, positions: Float64Array.from(nodes.flat()) }, forces, fixed);
  } catch (error) {
    throw error instanceof SolverError ? new FeaError(error.message) : error;
  }

  // Stresses at the corners of each element, averaged at the nodes; mid-edge nodes take their corners' mean.
  const stressSum = new Float64Array(count);
  const stressCount = new Uint16Array(count);
  const cornersL = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (const e of elements) {
    const x = e.map((id) => nodes[id] as Vec3);
    const u = new Float64Array(30);
    e.forEach((id, n) => u.set(displacement.subarray(id * 3, id * 3 + 3), n * 3));
    cornersL.forEach((L, c) => {
      const B = strainMatrix(gradients(x, L).grad);
      const strain = [0, 1, 2, 3, 4, 5].map((i) => {
        let s = 0;
        for (let k = 0; k < 30; k++) s += (B[i * 30 + k] as number) * (u[k] as number);
        return s;
      });
      const s = D.map((row) => row.reduce((sum, d, k) => sum + d * (strain[k] as number), 0)) as [number, number, number, number, number, number];
      const vonMises = Math.sqrt(0.5 * ((s[0] - s[1]) ** 2 + (s[1] - s[2]) ** 2 + (s[2] - s[0]) ** 2) + 3 * (s[3] ** 2 + s[4] ** 2 + s[5] ** 2));
      const id = e[c] as number;
      stressSum[id] = (stressSum[id] as number) + vonMises;
      stressCount[id] = (stressCount[id] as number) + 1;
    });
  }
  const stress = new Float32Array(count);
  for (let id = 0; id < corners.length; id++) stress[id] = stressCount[id] ? (stressSum[id] as number) / (stressCount[id] as number) : 0;
  for (const [key, id] of midOf) {
    const [p, q] = key.split(',').map(Number) as [number, number];
    stress[id] = ((stress[p] as number) + (stress[q] as number)) / 2;
  }
  return { positions: Float32Array.from(nodes.flat()), displacement: Float32Array.from(displacement), stress, elements: elements.length, surface: Uint32Array.from(surface) };
}

const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A 3 × 3 system, with a little regularisation for a face whose nodes lie on a line. */
function solve3(m: number[][], b: Vec3): Vec3 {
  const scale = Math.max(1e-12, ...m.flat().map(Math.abs));
  const a = m.map((row, i) => row.map((v, j) => v + (i === j ? scale * 1e-9 : 0)));
  const [r0, r1, r2] = a as [number[], number[], number[]];
  const det = (r0[0] as number) * ((r1[1] as number) * (r2[2] as number) - (r1[2] as number) * (r2[1] as number)) - (r0[1] as number) * ((r1[0] as number) * (r2[2] as number) - (r1[2] as number) * (r2[0] as number)) + (r0[2] as number) * ((r1[0] as number) * (r2[1] as number) - (r1[1] as number) * (r2[0] as number));
  const column = (k: number) => {
    const c = a.map((row, i) => row.map((v, j) => (j === k ? (b[i] as number) : v))) as [number[], number[], number[]];
    const [c0, c1, c2] = c;
    return ((c0[0] as number) * ((c1[1] as number) * (c2[2] as number) - (c1[2] as number) * (c2[1] as number)) - (c0[1] as number) * ((c1[0] as number) * (c2[2] as number) - (c1[2] as number) * (c2[0] as number)) + (c0[2] as number) * ((c1[0] as number) * (c2[1] as number) - (c1[1] as number) * (c2[0] as number))) / det;
  };
  return [column(0), column(1), column(2)];
}
