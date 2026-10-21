import type { MeshRepair } from '@core/contracts';
import { decimate } from './decimate';
import type { ReadMesh } from './mesh-readers';

export const noRepair: MeshRepair = { mergedVertices: 0, removedTriangles: 0, flippedTriangles: 0, closedHoles: 0 };

export const addRepairs = (a: MeshRepair, b: MeshRepair): MeshRepair => ({
  mergedVertices: a.mergedVertices + b.mergedVertices,
  removedTriangles: a.removedTriangles + b.removedTriangles,
  flippedTriangles: a.flippedTriangles + b.flippedTriangles,
  closedHoles: a.closedHoles + b.closedHoles,
});

/**
 * Meshes repaired, simplified to about `budget` triangles in all (each its share by its triangles),
 * and cleaned again. The repair reported is what the meshes as read needed.
 */
export function simplifyMeshes(meshes: readonly ReadMesh[], budget: number): { meshes: ReadMesh[]; repair: MeshRepair; triangles: number } {
  const total = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  let repair = noRepair;
  const simplified = meshes.map((mesh) => {
    const first = repairMesh(mesh);
    repair = addRepairs(repair, first.repair);
    const share = Math.max(4, Math.floor((budget * mesh.indices.length) / 3 / total));
    return repairMesh({ name: mesh.name, ...decimate(first.mesh, share) }).mesh;
  });
  return { meshes: simplified, repair, triangles: simplified.reduce((n, m) => n + m.indices.length / 3, 0) };
}

/**
 * A mesh made fit to become a solid: corners closer than a millionth of its size merged, repeated and
 * collapsed triangles removed, triangles turned so neighbours agree and each closed piece faces out,
 * and openings closed by a fan of triangles to a point in their middle. A sound mesh comes back as it was.
 */
export function repairMesh(mesh: ReadMesh): { mesh: ReadMesh; repair: MeshRepair } {
  const welded = mergeVertices(mesh.positions, mesh.indices);
  const cleaned = dropTriangles(welded.indices);
  const positions = welded.positions;
  const indices = cleaned.indices;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  // Half-edge h = 3t + k runs from corner k to corner k + 1 of triangle t; mate is the half-edge across
  // it (-1 on an opening, -2 where more than two triangles meet).
  const mate = new Int32Array(indices.length).fill(-1);
  const first = new Map<number, number>();
  for (let h = 0; h < indices.length; h++) {
    const [a, b] = ends(indices, h);
    const key = a < b ? a * vertexCount + b : b * vertexCount + a;
    const other = first.get(key);
    if (other === undefined) first.set(key, h);
    else if (mate[other] === -1) [mate[other], mate[h]] = [h, other];
    else {
      if ((mate[other] as number) >= 0) mate[mate[other] as number] = -2;
      mate[other] = -2;
      mate[h] = -2;
    }
  }

  // Orientation: walk each piece, turning neighbours that run along a shared edge the same way.
  const flip = new Uint8Array(triangleCount);
  const piece = new Int32Array(triangleCount).fill(-1);
  let pieces = 0;
  const queue = new Int32Array(triangleCount);
  for (let start = 0; start < triangleCount; start++) {
    if (piece[start] !== -1) continue;
    piece[start] = pieces;
    let [head, tail] = [0, 0];
    queue[tail++] = start;
    while (head < tail) {
      const t = queue[head++] as number;
      for (let k = 0; k < 3; k++) {
        const h = 3 * t + k;
        const m = mate[h] as number;
        if (m < 0) continue;
        const u = Math.floor(m / 3);
        if (piece[u] !== -1) continue;
        // The two half-edges agree when they run opposite ways once each triangle's flip is applied.
        const sameWay = (indices[h] as number) === (indices[m] as number);
        flip[u] = sameWay ? 1 - (flip[t] as number) : (flip[t] as number);
        piece[u] = pieces;
        queue[tail++] = u;
      }
    }
    pieces++;
  }

  // Openings: the boundary half-edges, as their triangles now run, traced backwards into loops.
  const outgoing = new Map<number, number[]>();
  const cornerPiece = new Map<number, number>();
  for (let h = 0; h < indices.length; h++) {
    if (mate[h] !== -1) continue;
    const [a, b] = ends(indices, h);
    const [from, to] = flip[Math.floor(h / 3)] ? [a, b] : [b, a];
    const list = outgoing.get(from);
    if (list) list.push(to);
    else outgoing.set(from, [to]);
    cornerPiece.set(from, piece[Math.floor(h / 3)] as number);
  }
  const added: number[] = [];
  const addedPiece: number[] = [];
  const extra: number[] = [];
  let closedHoles = 0;
  for (const start of [...outgoing.keys()]) {
    while (outgoing.get(start)?.length) {
      const loop = [start];
      let at = (outgoing.get(start) as number[]).pop() as number;
      while (at !== start && loop.length <= vertexCount) {
        loop.push(at);
        const next = outgoing.get(at)?.pop();
        if (next === undefined) break;
        at = next;
      }
      if (at !== start || loop.length < 3) continue;
      const owner = cornerPiece.get(loop[0] as number) ?? 0;
      closedHoles++;
      if (loop.length === 3) {
        added.push(loop[0] as number, loop[1] as number, loop[2] as number);
        addedPiece.push(owner);
        continue;
      }
      const centre = [0, 1, 2].map((axis) => loop.reduce((s, v) => s + (positions[v * 3 + axis] as number), 0) / loop.length);
      const c = vertexCount + extra.length / 3;
      extra.push(...centre);
      for (let i = 0; i < loop.length; i++) {
        added.push(loop[i] as number, loop[(i + 1) % loop.length] as number, c);
        addedPiece.push(owner);
      }
    }
  }

  const out = new Array<number>(indices.length + added.length);
  for (let t = 0; t < triangleCount; t++) {
    const [a, b, c] = [indices[3 * t] as number, indices[3 * t + 1] as number, indices[3 * t + 2] as number];
    if (flip[t]) [out[3 * t], out[3 * t + 1], out[3 * t + 2]] = [a, c, b];
    else [out[3 * t], out[3 * t + 1], out[3 * t + 2]] = [a, b, c];
  }
  for (let i = 0; i < added.length; i++) out[indices.length + i] = added[i] as number;
  const allPositions = extra.length ? [...positions, ...extra] : positions;

  // Outwards: a closed piece whose volume comes out negative faces in, and is turned over whole.
  const volumes = new Float64Array(pieces);
  const pieceOf = (t: number) => (t < triangleCount ? (piece[t] as number) : (addedPiece[t - triangleCount] as number));
  for (let t = 0; t < out.length / 3; t++) volumes[pieceOf(t)] = (volumes[pieceOf(t)] as number) + signedVolume(allPositions, out, t);
  let flippedTriangles = 0;
  for (let t = 0; t < out.length / 3; t++) {
    const turn = (volumes[pieceOf(t)] as number) < 0;
    if (turn) [out[3 * t + 1], out[3 * t + 2]] = [out[3 * t + 2] as number, out[3 * t + 1] as number];
    if (t < triangleCount && (turn ? !flip[t] : flip[t])) flippedTriangles++;
  }

  return {
    mesh: { name: mesh.name, positions: allPositions, indices: out },
    repair: { mergedVertices: welded.merged, removedTriangles: cleaned.removed, flippedTriangles, closedHoles },
  };
}

const ends = (indices: readonly number[], h: number): [number, number] => [indices[h] as number, indices[h - (h % 3) + ((h % 3) + 1) % 3] as number];

function signedVolume(positions: readonly number[], indices: readonly number[], t: number): number {
  const p = (k: number, axis: number) => positions[(indices[3 * t + k] as number) * 3 + axis] as number;
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = [p(0, 0), p(0, 1), p(0, 2), p(1, 0), p(1, 1), p(1, 2), p(2, 0), p(2, 1), p(2, 2)];
  return (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
}

/** Corners within a millionth of the mesh's size of each other become one; unused corners go. */
function mergeVertices(positions: readonly number[], indices: readonly number[]): { positions: number[]; indices: number[]; merged: number } {
  const count = positions.length / 3;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    low[i % 3] = Math.min(low[i % 3] as number, positions[i] as number);
    high[i % 3] = Math.max(high[i % 3] as number, positions[i] as number);
  }
  const size = Math.hypot(...[0, 1, 2].map((a) => (high[a] as number) - (low[a] as number))) || 1;
  const step = size * 1e-6;
  const cells = new Map<string, number>();
  const remap = new Int32Array(count).fill(-1);
  const used = new Uint8Array(count);
  for (const i of indices) used[i] = 1;
  const kept: number[] = [];
  let merged = 0;
  for (let v = 0; v < count; v++) {
    if (!used[v]) continue;
    const key = `${Math.round((positions[3 * v] as number) / step)},${Math.round((positions[3 * v + 1] as number) / step)},${Math.round((positions[3 * v + 2] as number) / step)}`;
    const at = cells.get(key);
    if (at !== undefined) {
      remap[v] = at;
      merged++;
      continue;
    }
    remap[v] = kept.length / 3;
    cells.set(key, remap[v] as number);
    kept.push(positions[3 * v] as number, positions[3 * v + 1] as number, positions[3 * v + 2] as number);
  }
  return { positions: kept, indices: indices.map((i) => remap[i] as number), merged };
}

/** Removes triangles with two corners at one place, and second copies of a triangle. */
function dropTriangles(indices: readonly number[]): { indices: number[]; removed: number } {
  const seen = new Set<string>();
  const kept: number[] = [];
  let removed = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] as number, indices[t + 1] as number, indices[t + 2] as number];
    const [low, high] = [Math.min(a, b, c), Math.max(a, b, c)];
    const key = `${low},${a + b + c - low - high},${high}`;
    if (a === b || b === c || a === c || seen.has(key)) {
      removed++;
      continue;
    }
    seen.add(key);
    kept.push(a, b, c);
  }
  return { indices: kept, removed };
}
