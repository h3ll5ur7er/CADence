import type { Vec3 } from '@core/contracts';

const leafSize = 4;

/**
 * Nearest-hit ray casting against a triangle mesh, over a bounding volume hierarchy (median split
 * along the longest axis). Plain TypeScript is fast enough here: see ADR-18.
 */
export class RayCaster {
  /** Per node: min xyz, max xyz. */
  private readonly bounds: Float64Array;
  /** Per node: second child (inner nodes, whose first child follows them) or first triangle (leaves), and triangle count (0 for inner nodes). */
  private readonly nodes: Int32Array;
  private readonly order: Uint32Array;
  private nodeCount = 0;

  constructor(
    private readonly positions: Float32Array,
    private readonly indices: Uint32Array,
  ) {
    const count = indices.length / 3;
    this.order = Uint32Array.from({ length: count }, (_, i) => i);
    const centers = new Float64Array(count * 3);
    for (let t = 0; t < count; t++)
      for (let axis = 0; axis < 3; axis++)
        centers[t * 3 + axis] = (this.vertex(t, 0, axis) + this.vertex(t, 1, axis) + this.vertex(t, 2, axis)) / 3;
    const capacity = 2 * count + 1; // leaves hold at least two triangles, so there are fewer nodes than triangles
    this.bounds = new Float64Array(capacity * 6);
    this.nodes = new Int32Array(capacity * 2);
    if (count > 0) this.build(centers, 0, count);
  }

  /** Distance to the nearest triangle along the (unit) direction, beyond `min`; undefined when nothing is hit. */
  cast(origin: Vec3, direction: Vec3, min = 0): number | undefined {
    if (this.nodeCount === 0) return undefined;
    const inverse = [1 / direction[0], 1 / direction[1], 1 / direction[2]];
    let best = Infinity;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop() as number;
      if (!this.hitsBox(node, origin, inverse, best)) continue;
      const first = this.nodes[node * 2] as number;
      const count = this.nodes[node * 2 + 1] as number;
      if (count === 0) {
        stack.push(node + 1, first);
        continue;
      }
      for (let i = first; i < first + count; i++) {
        const t = this.hitTriangle(this.order[i] as number, origin, direction);
        if (t !== undefined && t > min && t < best) best = t;
      }
    }
    return best === Infinity ? undefined : best;
  }

  /** How many times the ray crosses the mesh beyond its origin (odd: the origin is inside a closed mesh). */
  crossings(origin: Vec3, direction: Vec3): number {
    if (this.nodeCount === 0) return 0;
    const inverse = [1 / direction[0], 1 / direction[1], 1 / direction[2]];
    let count = 0;
    const stack = [0];
    while (stack.length) {
      const node = stack.pop() as number;
      if (!this.hitsBox(node, origin, inverse, Infinity)) continue;
      const first = this.nodes[node * 2] as number;
      const leaf = this.nodes[node * 2 + 1] as number;
      if (leaf === 0) {
        stack.push(node + 1, first);
        continue;
      }
      for (let i = first; i < first + leaf; i++) {
        const t = this.hitTriangle(this.order[i] as number, origin, direction);
        if (t !== undefined && t > 0) count++;
      }
    }
    return count;
  }

  private vertex(triangle: number, corner: number, axis: number): number {
    return this.positions[(this.indices[triangle * 3 + corner] as number) * 3 + axis] as number;
  }

  /** Builds the node for triangles order[start, end) and returns its index. */
  private build(centers: Float64Array, start: number, end: number): number {
    const node = this.nodeCount++;
    const box = this.bounds.subarray(node * 6, node * 6 + 6);
    box.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
    for (let i = start; i < end; i++) {
      const t = this.order[i] as number;
      for (let corner = 0; corner < 3; corner++)
        for (let axis = 0; axis < 3; axis++) {
          const v = this.vertex(t, corner, axis);
          if (v < (box[axis] as number)) box[axis] = v;
          if (v > (box[axis + 3] as number)) box[axis + 3] = v;
        }
    }
    if (end - start <= leafSize) {
      this.nodes[node * 2] = start;
      this.nodes[node * 2 + 1] = end - start;
      return node;
    }
    const extent = [0, 1, 2].map((a) => (box[a + 3] as number) - (box[a] as number));
    const axis = extent.indexOf(Math.max(...extent));
    const slice = Array.from(this.order.subarray(start, end)).sort((a, b) => (centers[a * 3 + axis] as number) - (centers[b * 3 + axis] as number));
    this.order.set(slice, start);
    const middle = (start + end) >> 1;
    // Built depth first, so the first child directly follows its parent.
    this.build(centers, start, middle);
    this.nodes[node * 2] = this.build(centers, middle, end);
    this.nodes[node * 2 + 1] = 0;
    return node;
  }

  private hitsBox(node: number, origin: Vec3, inverse: number[], best: number): boolean {
    let near = 0;
    let far = best;
    for (let axis = 0; axis < 3; axis++) {
      const inv = inverse[axis] as number;
      let t0 = ((this.bounds[node * 6 + axis] as number) - (origin[axis] as number)) * inv;
      let t1 = ((this.bounds[node * 6 + axis + 3] as number) - (origin[axis] as number)) * inv;
      if (t0 > t1) [t0, t1] = [t1, t0];
      if (Number.isNaN(t0)) t0 = -Infinity;
      if (Number.isNaN(t1)) t1 = Infinity;
      near = Math.max(near, t0);
      far = Math.min(far, t1);
      if (near > far) return false;
    }
    return true;
  }

  /** Möller–Trumbore, both sides. */
  private hitTriangle(t: number, origin: Vec3, d: Vec3): number | undefined {
    const ax = this.vertex(t, 0, 0), ay = this.vertex(t, 0, 1), az = this.vertex(t, 0, 2);
    const e1x = this.vertex(t, 1, 0) - ax, e1y = this.vertex(t, 1, 1) - ay, e1z = this.vertex(t, 1, 2) - az;
    const e2x = this.vertex(t, 2, 0) - ax, e2y = this.vertex(t, 2, 1) - ay, e2z = this.vertex(t, 2, 2) - az;
    const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return undefined;
    const inv = 1 / det;
    const sx = origin[0] - ax, sy = origin[1] - ay, sz = origin[2] - az;
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return undefined;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0 || u + v > 1) return undefined;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }
}
