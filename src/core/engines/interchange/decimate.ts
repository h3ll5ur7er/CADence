/**
 * Mesh decimation by quadric error (Garland and Heckbert), in the fast threshold form of Sven Forstmann's
 * "Fast Quadric Mesh Simplification": instead of a heap, each pass collapses every edge whose error lies
 * under a threshold that grows from pass to pass, until the mesh has as few triangles as asked (CAD-169).
 * Edges on an opening only collapse along the opening, and collapses that would fold a triangle over
 * are skipped, so the shape keeps its outline and its sides.
 */

interface Mesh {
  readonly positions: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
}

/** How fast the threshold grows; 7 is the reference's balance of speed and quality. */
const aggressiveness = 7;
const maxPasses = 200;

export function decimate(mesh: Mesh, target: number): { positions: number[]; indices: number[] } {
  let triangleCount = mesh.indices.length / 3;
  const vertexCount = mesh.positions.length / 3;
  if (triangleCount <= target) return { positions: Array.from(mesh.positions), indices: Array.from(mesh.indices) };

  // Work in a box of size 1, so the thresholds mean the same for every mesh.
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    low[i % 3] = Math.min(low[i % 3] as number, mesh.positions[i] as number);
    high[i % 3] = Math.max(high[i % 3] as number, mesh.positions[i] as number);
  }
  const scale = Math.hypot(...[0, 1, 2].map((a) => (high[a] as number) - (low[a] as number))) || 1;
  const p = new Float64Array(vertexCount * 3);
  for (let i = 0; i < p.length; i++) p[i] = ((mesh.positions[i] as number) - (low[i % 3] as number)) / scale;

  const q = new Float64Array(vertexCount * 10);
  const vStart = new Int32Array(vertexCount);
  const vCount = new Int32Array(vertexCount);
  const border = new Uint8Array(vertexCount);

  const tv = Int32Array.from(mesh.indices);
  const terr = new Float64Array(triangleCount * 4);
  const tn = new Float64Array(triangleCount * 3);
  const deleted = new Uint8Array(triangleCount);
  const dirty = new Uint8Array(triangleCount);

  let refT = new Int32Array(triangleCount * 3);
  let refV = new Uint8Array(triangleCount * 3);
  let refLength = 0;
  const pushRef = (t: number, v: number) => {
    if (refLength === refT.length) {
      const [grownT, grownV] = [new Int32Array(refT.length * 2), new Uint8Array(refV.length * 2)];
      grownT.set(refT);
      grownV.set(refV);
      [refT, refV] = [grownT, grownV];
    }
    refT[refLength] = t;
    refV[refLength++] = v;
  };

  const result = new Float64Array(3);
  // A scratch quadric: the sum of the two corners' quadrics.
  const sumQ = new Float64Array(10);
  const vertexError = (x: number, y: number, z: number) =>
    (sumQ[0] as number) * x * x + 2 * (sumQ[1] as number) * x * y + 2 * (sumQ[2] as number) * x * z + 2 * (sumQ[3] as number) * x +
    (sumQ[4] as number) * y * y + 2 * (sumQ[5] as number) * y * z + 2 * (sumQ[6] as number) * y +
    (sumQ[7] as number) * z * z + 2 * (sumQ[8] as number) * z + (sumQ[9] as number);
  const detSum = (a11: number, a12: number, a13: number, a21: number, a22: number, a23: number, a31: number, a32: number, a33: number) =>
    (sumQ[a11] as number) * (sumQ[a22] as number) * (sumQ[a33] as number) +
    (sumQ[a13] as number) * (sumQ[a21] as number) * (sumQ[a32] as number) +
    (sumQ[a12] as number) * (sumQ[a23] as number) * (sumQ[a31] as number) -
    (sumQ[a13] as number) * (sumQ[a22] as number) * (sumQ[a31] as number) -
    (sumQ[a11] as number) * (sumQ[a23] as number) * (sumQ[a32] as number) -
    (sumQ[a12] as number) * (sumQ[a21] as number) * (sumQ[a33] as number);

  /** The error of collapsing edge a–b, with the best place for the merged corner in `result`. */
  const collapseError = (a: number, b: number): number => {
    for (let k = 0; k < 10; k++) sumQ[k] = (q[a * 10 + k] as number) + (q[b * 10 + k] as number);
    const d = detSum(0, 1, 2, 1, 4, 5, 2, 5, 7);
    if (d !== 0 && !(border[a] && border[b])) {
      result[0] = (-1 / d) * detSum(1, 2, 3, 4, 5, 6, 5, 7, 8);
      result[1] = (1 / d) * detSum(0, 2, 3, 1, 5, 6, 2, 7, 8);
      result[2] = (-1 / d) * detSum(0, 1, 3, 1, 4, 6, 2, 5, 8);
      return vertexError(result[0] as number, result[1] as number, result[2] as number);
    }
    const [ax, ay, az, bx, by, bz] = [p[3 * a], p[3 * a + 1], p[3 * a + 2], p[3 * b], p[3 * b + 1], p[3 * b + 2]] as number[] as [number, number, number, number, number, number];
    const [mx, my, mz] = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];
    const [ea, eb, em] = [vertexError(ax, ay, az), vertexError(bx, by, bz), vertexError(mx, my, mz)];
    const least = Math.min(ea, eb, em);
    if (least === ea) [result[0], result[1], result[2]] = [ax, ay, az];
    else if (least === eb) [result[0], result[1], result[2]] = [bx, by, bz];
    else [result[0], result[1], result[2]] = [mx, my, mz];
    return least;
  };

  const normalOf = (t: number) => {
    const [a, b, c] = [tv[3 * t] as number, tv[3 * t + 1] as number, tv[3 * t + 2] as number];
    const [ux, uy, uz] = [(p[3 * b] as number) - (p[3 * a] as number), (p[3 * b + 1] as number) - (p[3 * a + 1] as number), (p[3 * b + 2] as number) - (p[3 * a + 2] as number)];
    const [vx, vy, vz] = [(p[3 * c] as number) - (p[3 * a] as number), (p[3 * c + 1] as number) - (p[3 * a + 1] as number), (p[3 * c + 2] as number) - (p[3 * a + 2] as number)];
    const [nx, ny, nz] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const length = Math.hypot(nx, ny, nz) || 1;
    [tn[3 * t], tn[3 * t + 1], tn[3 * t + 2]] = [nx / length, ny / length, nz / length];
  };

  const triangleErrors = (t: number) => {
    let least = Infinity;
    for (let j = 0; j < 3; j++) {
      const e = collapseError(tv[3 * t + j] as number, tv[3 * t + ((j + 1) % 3)] as number);
      terr[4 * t + j] = e;
      least = Math.min(least, e);
    }
    terr[4 * t + 3] = least;
  };

  const updateMesh = (pass: number) => {
    if (pass > 0) {
      let kept = 0;
      for (let t = 0; t < triangleCount; t++) {
        if (deleted[t]) continue;
        if (kept !== t) {
          tv.copyWithin(3 * kept, 3 * t, 3 * t + 3);
          terr.copyWithin(4 * kept, 4 * t, 4 * t + 4);
          tn.copyWithin(3 * kept, 3 * t, 3 * t + 3);
        }
        deleted[kept] = 0;
        dirty[kept] = 0;
        kept++;
      }
      triangleCount = kept;
    }
    if (pass === 0) {
      q.fill(0);
      for (let t = 0; t < triangleCount; t++) {
        normalOf(t);
        const [nx, ny, nz] = [tn[3 * t] as number, tn[3 * t + 1] as number, tn[3 * t + 2] as number];
        const a = tv[3 * t] as number;
        const d = -(nx * (p[3 * a] as number) + ny * (p[3 * a + 1] as number) + nz * (p[3 * a + 2] as number));
        const plane = [nx * nx, nx * ny, nx * nz, nx * d, ny * ny, ny * nz, ny * d, nz * nz, nz * d, d * d];
        for (let j = 0; j < 3; j++) {
          const v = (tv[3 * t + j] as number) * 10;
          for (let k = 0; k < 10; k++) q[v + k] = (q[v + k] as number) + (plane[k] as number);
        }
      }
    }
    // Each corner's triangles, as references into refT / refV.
    vCount.fill(0);
    for (let i = 0; i < triangleCount * 3; i++) vCount[tv[i] as number] = (vCount[tv[i] as number] as number) + 1;
    let start = 0;
    for (let v = 0; v < vertexCount; v++) {
      vStart[v] = start;
      start += vCount[v] as number;
      vCount[v] = 0;
    }
    if (refT.length < triangleCount * 3) [refT, refV] = [new Int32Array(triangleCount * 3), new Uint8Array(triangleCount * 3)];
    refLength = triangleCount * 3;
    for (let t = 0; t < triangleCount; t++) {
      for (let j = 0; j < 3; j++) {
        const v = tv[3 * t + j] as number;
        const r = (vStart[v] as number) + (vCount[v] as number);
        vCount[v] = (vCount[v] as number) + 1;
        refT[r] = t;
        refV[r] = j;
      }
    }
    if (pass === 0) {
      // A corner is on an opening when one of its neighbours shares only one triangle with it.
      const seen = new Map<number, number>();
      border.fill(0);
      for (let v = 0; v < vertexCount; v++) {
        seen.clear();
        for (let r = vStart[v] as number; r < (vStart[v] as number) + (vCount[v] as number); r++) {
          const t = refT[r] as number;
          for (let j = 0; j < 3; j++) {
            const w = tv[3 * t + j] as number;
            seen.set(w, (seen.get(w) ?? 0) + 1);
          }
        }
        for (const [w, n] of seen) {
          if (n === 1) {
            border[v] = 1;
            border[w] = 1;
          }
        }
      }
      for (let t = 0; t < triangleCount; t++) triangleErrors(t);
    }
  };

  let skip0 = new Uint8Array(16);
  let skip1 = new Uint8Array(16);
  /** Whether moving corner `a` (joined with `b`) to `result` folds one of a's other triangles over. */
  const flips = (a: number, b: number, skip: Uint8Array) => {
    const [px, py, pz] = [result[0] as number, result[1] as number, result[2] as number];
    for (let k = 0; k < (vCount[a] as number); k++) {
      const r = (vStart[a] as number) + k;
      const t = refT[r] as number;
      if (deleted[t]) continue;
      const s = refV[r] as number;
      const id1 = tv[3 * t + ((s + 1) % 3)] as number;
      const id2 = tv[3 * t + ((s + 2) % 3)] as number;
      if (id1 === b || id2 === b) {
        skip[k] = 1;
        continue;
      }
      skip[k] = 0;
      let [d1x, d1y, d1z] = [(p[3 * id1] as number) - px, (p[3 * id1 + 1] as number) - py, (p[3 * id1 + 2] as number) - pz];
      let [d2x, d2y, d2z] = [(p[3 * id2] as number) - px, (p[3 * id2 + 1] as number) - py, (p[3 * id2 + 2] as number) - pz];
      const l1 = Math.hypot(d1x, d1y, d1z) || 1;
      const l2 = Math.hypot(d2x, d2y, d2z) || 1;
      [d1x, d1y, d1z] = [d1x / l1, d1y / l1, d1z / l1];
      [d2x, d2y, d2z] = [d2x / l2, d2y / l2, d2z / l2];
      if (Math.abs(d1x * d2x + d1y * d2y + d1z * d2z) > 0.999) return true;
      const [nx, ny, nz] = [d1y * d2z - d1z * d2y, d1z * d2x - d1x * d2z, d1x * d2y - d1y * d2x];
      const length = Math.hypot(nx, ny, nz) || 1;
      if ((nx * (tn[3 * t] as number) + ny * (tn[3 * t + 1] as number) + nz * (tn[3 * t + 2] as number)) / length < 0.2) return true;
    }
    return false;
  };

  // Link condition: an edge may only collapse when its ends share no neighbours but the corners of the
  // triangles along it, or the mesh would pinch into edges of more than two triangles.
  const mark = new Int32Array(vertexCount);
  const counted = new Int32Array(vertexCount);
  let stamp = 0;
  const pinches = (a: number, b: number) => {
    stamp++;
    for (let k = 0; k < (vCount[a] as number); k++) {
      const t = refT[(vStart[a] as number) + k] as number;
      if (deleted[t]) continue;
      for (let j = 0; j < 3; j++) mark[tv[3 * t + j] as number] = stamp;
    }
    let shared = 0;
    for (let k = 0; k < (vCount[b] as number); k++) {
      const t = refT[(vStart[b] as number) + k] as number;
      if (deleted[t]) continue;
      for (let j = 0; j < 3; j++) {
        const w = tv[3 * t + j] as number;
        if (w === a || w === b || mark[w] !== stamp || counted[w] === stamp) continue;
        counted[w] = stamp;
        shared++;
      }
    }
    return shared > (border[a] && border[b] ? 1 : 2);
  };

  let deletedCount = 0;
  /** Moves corner `from`'s triangles onto corner `to`; the ones along the collapsed edge go. */
  const moveTriangles = (to: number, from: number, skip: Uint8Array) => {
    for (let k = 0; k < (vCount[from] as number); k++) {
      const r = (vStart[from] as number) + k;
      const t = refT[r] as number;
      if (deleted[t]) continue;
      if (skip[k]) {
        deleted[t] = 1;
        deletedCount++;
        continue;
      }
      tv[3 * t + (refV[r] as number)] = to;
      dirty[t] = 1;
      normalOf(t);
      triangleErrors(t);
      pushRef(t, refV[r] as number);
    }
  };

  const goal = triangleCount - target;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (deletedCount >= goal) break;
    if (pass % 5 === 0) updateMesh(pass);
    dirty.fill(0, 0, triangleCount);
    const threshold = 1e-9 * Math.pow(pass + 3, aggressiveness);
    for (let t = 0; t < triangleCount && deletedCount < goal; t++) {
      if ((terr[4 * t + 3] as number) > threshold || deleted[t] || dirty[t]) continue;
      for (let j = 0; j < 3; j++) {
        if ((terr[4 * t + j] as number) >= threshold) continue;
        const i0 = tv[3 * t + j] as number;
        const i1 = tv[3 * t + ((j + 1) % 3)] as number;
        if (border[i0] !== border[i1] || pinches(i0, i1)) continue;
        collapseError(i0, i1);
        if (skip0.length < (vCount[i0] as number)) skip0 = new Uint8Array((vCount[i0] as number) * 2);
        if (skip1.length < (vCount[i1] as number)) skip1 = new Uint8Array((vCount[i1] as number) * 2);
        if (flips(i0, i1, skip0) || flips(i1, i0, skip1)) continue;
        [p[3 * i0], p[3 * i0 + 1], p[3 * i0 + 2]] = [result[0] as number, result[1] as number, result[2] as number];
        for (let k = 0; k < 10; k++) q[i0 * 10 + k] = (q[i0 * 10 + k] as number) + (q[i1 * 10 + k] as number);
        const start = refLength;
        moveTriangles(i0, i0, skip0);
        moveTriangles(i0, i1, skip1);
        const count = refLength - start;
        if (count <= (vCount[i0] as number)) {
          // Fits where the corner's references were: copy them back and free the new ones.
          if (count) {
            refT.copyWithin(vStart[i0] as number, start, start + count);
            refV.copyWithin(vStart[i0] as number, start, start + count);
          }
          refLength = start;
        } else vStart[i0] = start;
        vCount[i0] = count;
        break;
      }
    }
  }

  // The triangles left, with only the corners they use.
  const remap = new Int32Array(vertexCount).fill(-1);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    if (deleted[t]) continue;
    for (let j = 0; j < 3; j++) {
      const v = tv[3 * t + j] as number;
      if (remap[v] === -1) {
        remap[v] = positions.length / 3;
        positions.push(...[0, 1, 2].map((a) => (p[3 * v + a] as number) * scale + (low[a] as number)));
      }
      indices.push(remap[v] as number);
    }
  }
  return { positions, indices };
}
