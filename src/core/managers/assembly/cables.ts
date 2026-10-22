import type { BodyMesh, Cable, Matrix4, Vec3 } from '@core/contracts';
import { transformPoint } from '@core/utilities/math';

/** Samples of a cable's centre line per piece between two of its points. */
const perPiece = 24;
/** Sides of the tube drawn for a cable. */
const sides = 10;

/** Where a cable runs in a pose (CAD-192): its centre line, its length and its tightest bend. */
export interface CableRoute {
  readonly samples: readonly Vec3[];
  /** mm. */
  readonly length: number;
  /** The smallest radius of curvature along it (mm); Infinity when straight. */
  readonly bendRadius: number;
  /** Where the tightest bend is. */
  readonly tightest: Vec3;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (norm(a) || 1));

/** A point's direction in the assembly: its instance's direction turned with the instance. */
const turned = (pose: Matrix4, direction: Vec3): Vec3 => unit([0, 1, 2].map((k) => (pose[k] as number) * direction[0] + (pose[4 + k] as number) * direction[1] + (pose[8 + k] as number) * direction[2]) as unknown as Vec3);

/**
 * The cable's centre line where the poses put its points: cubic pieces between them (Hermite), each
 * point left along its direction when it has one, else towards its neighbours; undefined while one of
 * its instances has no pose.
 */
export function cableRoute(cable: Cable, poses: ReadonlyMap<string, Matrix4>): CableRoute | undefined {
  const points: Vec3[] = [];
  const given: (Vec3 | undefined)[] = [];
  for (const point of cable.points) {
    const pose = poses.get(point.instance);
    if (!pose) return undefined;
    points.push(transformPoint(pose, point.point));
    given.push(point.direction ? turned(pose, point.direction) : undefined);
  }
  if (points.length < 2) return undefined;
  const last = points.length - 1;
  const tangents = points.map((p, i) => {
    const span = norm(sub(points[Math.min(i + 1, last)] as Vec3, points[Math.max(i - 1, 0)] as Vec3)) / (i === 0 || i === last ? 1 : 2);
    const direction = given[i];
    if (direction) return scale(direction, span);
    return i === 0 ? sub(points[1] as Vec3, p) : i === last ? sub(p, points[last - 1] as Vec3) : scale(sub(points[i + 1] as Vec3, points[i - 1] as Vec3), 0.5);
  });
  const samples: Vec3[] = [points[0] as Vec3];
  for (let i = 0; i < last; i++) {
    const [p0, p1, m0, m1] = [points[i] as Vec3, points[i + 1] as Vec3, tangents[i] as Vec3, tangents[i + 1] as Vec3];
    for (let k = 1; k <= perPiece; k++) {
      const t = k / perPiece;
      const [h00, h10, h01, h11] = [2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2];
      samples.push(add(add(scale(p0, h00), scale(m0, h10)), add(scale(p1, h01), scale(m1, h11))));
    }
  }
  let length = 0;
  let [bendRadius, tightest] = [Infinity, points[0] as Vec3];
  for (let i = 1; i < samples.length; i++) {
    length += norm(sub(samples[i] as Vec3, samples[i - 1] as Vec3));
    if (i === samples.length - 1) continue;
    // The circle through three samples in a row: R = abc / 4 · area.
    const [a, b, c] = [samples[i - 1] as Vec3, samples[i] as Vec3, samples[i + 1] as Vec3];
    const area = norm(cross(sub(b, a), sub(c, a))) / 2;
    if (area < 1e-12) continue;
    const radius = (norm(sub(b, a)) * norm(sub(c, b)) * norm(sub(c, a))) / (4 * area);
    if (radius < bendRadius) [bendRadius, tightest] = [radius, b];
  }
  return { samples, length, bendRadius, tightest };
}

/** A tube round the centre line, to draw: one body, its outside a single face. */
export function cableMesh(cable: Cable, route: CableRoute): BodyMesh {
  const { samples } = route;
  const r = cable.diameter / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // A frame carried along the line, turned as little as it can be (no twist at sharp turns).
  let side: Vec3 = [0, 0, 1];
  samples.forEach((p, i) => {
    const forward = unit(sub(samples[Math.min(i + 1, samples.length - 1)] as Vec3, samples[Math.max(i - 1, 0)] as Vec3));
    let across = cross(forward, side);
    if (norm(across) < 1e-6) across = cross(forward, Math.abs(forward[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    across = unit(across);
    side = unit(cross(across, forward));
    for (let k = 0; k < sides; k++) {
      const a = (2 * Math.PI * k) / sides;
      const n = add(scale(across, Math.cos(a)), scale(side, Math.sin(a)));
      positions.push(...add(p, scale(n, r)));
      normals.push(...n);
    }
    if (i === 0) return;
    for (let k = 0; k < sides; k++) {
      const [a, b, c, d] = [(i - 1) * sides + k, (i - 1) * sides + ((k + 1) % sides), i * sides + ((k + 1) % sides), i * sides + k];
      indices.push(a, b, c, a, c, d);
    }
  });
  return {
    body: `cable:${cable.id}`,
    key: `cable:${cable.id}:${route.length}`,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    faces: [{ name: `f:cable:${cable.id}`, start: 0, count: indices.length, planar: false, center: samples[Math.floor(samples.length / 2)] as Vec3 }],
    edgePositions: new Float32Array(),
    edges: [],
  };
}

/** Samples of the route that may touch the parts it is fastened to: near its points on them. */
export function fastened(cable: Cable, route: CableRoute, poses: ReadonlyMap<string, Matrix4>, instance: string): (sample: Vec3) => boolean {
  const near = cable.points.filter((p) => p.instance === instance).flatMap((p) => (poses.get(instance) ? [transformPoint(poses.get(instance) as Matrix4, p.point)] : []));
  const reach = Math.max(2 * cable.diameter, 10);
  return (sample) => near.some((q) => norm(sub(sample, q)) <= reach);
}

const boxes = new WeakMap<BodyMesh, { min: Vec3; max: Vec3 }>();
const rays: readonly Vec3[] = [
  [0.5773, 0.5774, 0.5775],
  [-0.6121, 0.4472, -0.6521],
  [0.2673, -0.8018, 0.5345],
];

/** Whether a point (in the mesh's coordinates) is inside a closed mesh: most of three skewed rays cross it an odd number of times. */
export function insideMesh(mesh: BodyMesh, p: Vec3): boolean {
  let box = boxes.get(mesh);
  if (!box) {
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i++) {
      const k = i % 3;
      min[k] = Math.min(min[k] as number, mesh.positions[i] as number);
      max[k] = Math.max(max[k] as number, mesh.positions[i] as number);
    }
    box = { min, max };
    boxes.set(mesh, box);
  }
  if ([0, 1, 2].some((k) => (p[k] as number) < (box.min[k] as number) || (p[k] as number) > (box.max[k] as number))) return false;
  const vertex = (i: number): Vec3 => [mesh.positions[i * 3] as number, mesh.positions[i * 3 + 1] as number, mesh.positions[i * 3 + 2] as number];
  let votes = 0;
  for (const d of rays) {
    let crossings = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      // Möller–Trumbore, forwards only.
      const [a, b, c] = [vertex(mesh.indices[t] as number), vertex(mesh.indices[t + 1] as number), vertex(mesh.indices[t + 2] as number)];
      const [e1, e2] = [sub(b, a), sub(c, a)];
      const h = cross(d, e2);
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
      if (Math.abs(det) < 1e-12) continue;
      const s = sub(p, a);
      const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = cross(s, e1);
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 1e-9) crossings++;
    }
    if (crossings % 2 === 1) votes++;
  }
  return votes >= 2;
}
