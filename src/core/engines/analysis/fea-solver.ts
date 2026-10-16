/**
 * The linear solver of the strength check (CAD-93, CAD-94): K u = f for a stiffness matrix in 3 × 3
 * block CSR (both halves stored, columns sorted per row), with fixed nodes held at zero.
 *
 * Conjugate gradients with a two-level preconditioner: a symmetric Gauss-Seidel sweep smooths the
 * error locally, and a coarse correction removes what sweeps hardly touch (the bending of thin
 * plates and long beams). The coarse space moves regions of the part as rigid bodies, six motions
 * per region, and is solved directly. Thin parts need about 30 steps instead of over a thousand
 * (ADR-42).
 */

export interface StiffnessSystem {
  readonly rowStart: Int32Array;
  readonly columns: Int32Array;
  /** 9 per block, row by row; changed in place (fixed rows and columns cleared). */
  readonly values: Float64Array;
  /** Node positions (3 each), to group nodes into regions. */
  readonly positions: Float64Array;
}

export class SolverError extends Error {}

/** About this many regions: few enough for a quick dense solve (6 unknowns each). */
const regions = 120;
const tolerance = 1e-6;

export function solveStiffness(system: StiffnessSystem, f: Float64Array, fixed: Uint8Array): Float64Array {
  const { rowStart, columns, values } = system;
  const n = f.length;
  const nodes = n / 3;
  // Fixed nodes: their rows and columns cleared and a unit diagonal, so they stay at zero.
  for (let a = 0; a < nodes; a++)
    for (let k = rowStart[a] as number; k < (rowStart[a + 1] as number); k++) {
      const b = columns[k] as number;
      if (!fixed[a] && !fixed[b]) continue;
      values.fill(0, k * 9, k * 9 + 9);
      if (a === b) values[k * 9] = values[k * 9 + 4] = values[k * 9 + 8] = 1;
    }
  const diagonal = new Int32Array(nodes);
  for (let a = 0; a < nodes; a++)
    for (let k = rowStart[a] as number; k < (rowStart[a + 1] as number); k++) if (columns[k] === a) diagonal[a] = k;

  const multiply = (x: Float64Array, y: Float64Array) => {
    for (let a = 0; a < nodes; a++) {
      let y0 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let k = rowStart[a] as number; k < (rowStart[a + 1] as number); k++) {
        const c = (columns[k] as number) * 3;
        const v = k * 9;
        const x0 = x[c] as number;
        const x1 = x[c + 1] as number;
        const x2 = x[c + 2] as number;
        y0 += (values[v] as number) * x0 + (values[v + 1] as number) * x1 + (values[v + 2] as number) * x2;
        y1 += (values[v + 3] as number) * x0 + (values[v + 4] as number) * x1 + (values[v + 5] as number) * x2;
        y2 += (values[v + 6] as number) * x0 + (values[v + 7] as number) * x1 + (values[v + 8] as number) * x2;
      }
      y[a * 3] = y0;
      y[a * 3 + 1] = y1;
      y[a * 3 + 2] = y2;
    }
  };

  /** One Gauss-Seidel sweep on K z = r, forward or backward, from the current z. */
  const sweep = (r: Float64Array, z: Float64Array, forward: boolean) => {
    for (let t = 0; t < nodes; t++) {
      const a = forward ? t : nodes - 1 - t;
      const own = diagonal[a] as number;
      let s0 = r[a * 3] as number;
      let s1 = r[a * 3 + 1] as number;
      let s2 = r[a * 3 + 2] as number;
      for (let k = rowStart[a] as number; k < (rowStart[a + 1] as number); k++) {
        if (k === own) continue;
        const c = (columns[k] as number) * 3;
        const v = k * 9;
        const z0 = z[c] as number;
        const z1 = z[c + 1] as number;
        const z2 = z[c + 2] as number;
        s0 -= (values[v] as number) * z0 + (values[v + 1] as number) * z1 + (values[v + 2] as number) * z2;
        s1 -= (values[v + 3] as number) * z0 + (values[v + 4] as number) * z1 + (values[v + 5] as number) * z2;
        s2 -= (values[v + 6] as number) * z0 + (values[v + 7] as number) * z1 + (values[v + 8] as number) * z2;
      }
      const d = own * 9;
      const [d0, d1, d2, d3, d4, d5, d6, d7, d8] = values.subarray(d, d + 9) as unknown as number[];
      if (forward) {
        const z0 = (s0 - (d1 as number) * (z[a * 3 + 1] as number) - (d2 as number) * (z[a * 3 + 2] as number)) / (d0 as number);
        const z1 = (s1 - (d3 as number) * z0 - (d5 as number) * (z[a * 3 + 2] as number)) / (d4 as number);
        z[a * 3] = z0;
        z[a * 3 + 1] = z1;
        z[a * 3 + 2] = (s2 - (d6 as number) * z0 - (d7 as number) * z1) / (d8 as number);
      } else {
        const z2 = (s2 - (d6 as number) * (z[a * 3] as number) - (d7 as number) * (z[a * 3 + 1] as number)) / (d8 as number);
        const z1 = (s1 - (d3 as number) * (z[a * 3] as number) - (d5 as number) * z2) / (d4 as number);
        z[a * 3 + 2] = z2;
        z[a * 3 + 1] = z1;
        z[a * 3] = (s0 - (d1 as number) * z1 - (d2 as number) * z2) / (d0 as number);
      }
    }
  };

  const coarse = rigidRegions(system, fixed);
  const residual = new Float64Array(n);
  /** z = M⁻¹ r: a forward sweep, the coarse correction, a backward sweep (symmetric, as CG needs). */
  const precondition = (r: Float64Array, z: Float64Array) => {
    z.fill(0);
    sweep(r, z, true);
    multiply(z, residual);
    for (let i = 0; i < n; i++) residual[i] = (r[i] as number) - (residual[i] as number);
    coarse.correct(residual, z);
    sweep(r, z, false);
  };
  const dot = (u: Float64Array, v: Float64Array) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += (u[i] as number) * (v[i] as number);
    return s;
  };

  const x = new Float64Array(n);
  const r = Float64Array.from(f, (v, i) => (fixed[Math.floor(i / 3)] ? 0 : v));
  const z = new Float64Array(n);
  precondition(r, z);
  const p = Float64Array.from(z);
  const q = new Float64Array(n);
  let rz = dot(r, z);
  const rz0 = rz;
  for (let iteration = 0; iteration < 2_000; iteration++) {
    multiply(p, q);
    const pq = dot(p, q);
    if (!(pq > 0)) throw new SolverError('The part is not held enough to stay put: fix more faces.');
    const alpha = rz / pq;
    for (let i = 0; i < n; i++) {
      x[i] = (x[i] as number) + alpha * (p[i] as number);
      r[i] = (r[i] as number) - alpha * (q[i] as number);
    }
    precondition(r, z);
    const next = dot(r, z);
    // Settled: the preconditioned residual a millionth of where it started.
    if (!(rz0 > 0) || Math.sqrt(next / rz0) < tolerance) return x;
    const beta = next / rz;
    rz = next;
    for (let i = 0; i < n; i++) p[i] = (z[i] as number) + beta * (p[i] as number);
  }
  throw new SolverError('The solution did not settle: the part may be held too loosely.');
}

/**
 * The coarse space: nodes grouped by a grid of about `regions` cells, each moving as a rigid body
 * (three shifts, three turns about its middle). Its matrix Pᵀ K P is small and solved by Cholesky.
 */
function rigidRegions(system: StiffnessSystem, fixed: Uint8Array): { correct(residual: Float64Array, z: Float64Array): void } {
  const { rowStart, columns, values, positions } = system;
  const nodes = rowStart.length - 1;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  positions.forEach((v, i) => {
    min[i % 3] = Math.min(min[i % 3] as number, v);
    max[i % 3] = Math.max(max[i % 3] as number, v);
  });
  const extent = max.map((v, k) => Math.max(v - (min[k] as number), 1e-9));
  let cell = Math.cbrt(((extent[0] as number) * (extent[1] as number) * (extent[2] as number)) / regions);
  const countsOf = () => extent.map((v) => Math.max(1, Math.ceil(v / cell)));
  // Thin and long parts round many cells up: grow them until there are about as many as wanted.
  while (countsOf().reduce((p, c) => p * c, 1) > regions * 1.5) cell *= 1.1;
  const counts = countsOf();
  const regionOfCell = new Map<number, number>();
  const region = new Int32Array(nodes);
  for (let a = 0; a < nodes; a++) {
    const c = [0, 1, 2].map((k) => Math.min((counts[k] as number) - 1, Math.floor(((positions[a * 3 + k] as number) - (min[k] as number)) / cell)));
    const key = (c[0] as number) + (counts[0] as number) * ((c[1] as number) + (counts[1] as number) * (c[2] as number));
    let g = regionOfCell.get(key);
    if (g === undefined) regionOfCell.set(key, (g = regionOfCell.size));
    region[a] = g;
  }
  const m = regionOfCell.size;
  const middle = new Float64Array(m * 3);
  const members = new Int32Array(m);
  for (let a = 0; a < nodes; a++) {
    const g = region[a] as number;
    members[g] = (members[g] as number) + 1;
    for (let k = 0; k < 3; k++) middle[g * 3 + k] = (middle[g * 3 + k] as number) + (positions[a * 3 + k] as number);
  }
  for (let g = 0; g < m; g++) for (let k = 0; k < 3; k++) middle[g * 3 + k] = (middle[g * 3 + k] as number) / (members[g] as number);

  // P per node: 3 × 6 (shifts, then turns; arms scaled by the cell so the columns are alike in size). Fixed nodes do not move.
  const P = new Float64Array(nodes * 18);
  for (let a = 0; a < nodes; a++) {
    if (fixed[a]) continue;
    const g = region[a] as number;
    const [dx, dy, dz] = [0, 1, 2].map((k) => ((positions[a * 3 + k] as number) - (middle[g * 3 + k] as number)) / cell) as [number, number, number];
    P.set([1, 0, 0, 0, dz, -dy, 0, 1, 0, -dz, 0, dx, 0, 0, 1, dy, -dx, 0], a * 18);
  }
  const size = m * 6;
  const A = new Float64Array(size * size);
  const KP = new Float64Array(18);
  for (let a = 0; a < nodes; a++) {
    if (fixed[a]) continue;
    const ga = (region[a] as number) * 6;
    for (let k = rowStart[a] as number; k < (rowStart[a + 1] as number); k++) {
      const b = columns[k] as number;
      if (fixed[b]) continue;
      const gb = (region[b] as number) * 6;
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 6; j++) {
          let s = 0;
          for (let l = 0; l < 3; l++) s += (values[k * 9 + i * 3 + l] as number) * (P[b * 18 + l * 6 + j] as number);
          KP[i * 6 + j] = s;
        }
      for (let i = 0; i < 6; i++)
        for (let j = 0; j < 6; j++) {
          let s = 0;
          for (let l = 0; l < 3; l++) s += (P[a * 18 + l * 6 + i] as number) * (KP[l * 6 + j] as number);
          A[(ga + i) * size + gb + j] = (A[(ga + i) * size + gb + j] as number) + s;
        }
    }
  }
  // Cholesky in place (lower half); motions a region cannot make (all of it fixed) are left out.
  let largest = 0;
  for (let i = 0; i < size; i++) largest = Math.max(largest, A[i * size + i] as number);
  const active = new Uint8Array(size);
  for (let j = 0; j < size; j++) {
    let d = A[j * size + j] as number;
    for (let k = 0; k < j; k++) d -= (A[j * size + k] as number) ** 2;
    if (!(d > 1e-10 * largest)) {
      for (let i = j; i < size; i++) A[i * size + j] = 0;
      A[j * size + j] = 1;
      continue;
    }
    active[j] = 1;
    const l = Math.sqrt(d);
    A[j * size + j] = l;
    for (let i = j + 1; i < size; i++) {
      let s = A[i * size + j] as number;
      for (let k = 0; k < j; k++) s -= (A[i * size + k] as number) * (A[j * size + k] as number);
      A[i * size + j] = s / l;
    }
  }

  const coarse = new Float64Array(size);
  return {
    /** z += P (Pᵀ K P)⁻¹ Pᵀ residual. */
    correct(residual, z) {
      coarse.fill(0);
      for (let a = 0; a < nodes; a++) {
        const g = (region[a] as number) * 6;
        for (let j = 0; j < 6; j++) {
          let s = 0;
          for (let i = 0; i < 3; i++) s += (P[a * 18 + i * 6 + j] as number) * (residual[a * 3 + i] as number);
          coarse[g + j] = (coarse[g + j] as number) + s;
        }
      }
      for (let i = 0; i < size; i++) {
        let s = active[i] ? (coarse[i] as number) : 0;
        for (let k = 0; k < i; k++) s -= (A[i * size + k] as number) * (coarse[k] as number);
        coarse[i] = s / (A[i * size + i] as number);
      }
      for (let i = size - 1; i >= 0; i--) {
        let s = coarse[i] as number;
        for (let k = i + 1; k < size; k++) s -= (A[k * size + i] as number) * (coarse[k] as number);
        coarse[i] = active[i] ? s / (A[i * size + i] as number) : 0;
      }
      for (let a = 0; a < nodes; a++) {
        const g = (region[a] as number) * 6;
        for (let i = 0; i < 3; i++) {
          let s = 0;
          for (let j = 0; j < 6; j++) s += (P[a * 18 + i * 6 + j] as number) * (coarse[g + j] as number);
          z[a * 3 + i] = (z[a * 3 + i] as number) + s;
        }
      }
    },
  };
}
