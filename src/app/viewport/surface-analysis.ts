import type { BodyMesh, Vec3 } from '@core/contracts';

/**
 * How faces are coloured to show their shape (CAD-91): zebra stripes (smoothness across edges),
 * curvature (flat blue to tightly curved red) or draft against a pull direction (green and blue
 * draw out, yellow needs more draft).
 */
export type SurfaceAnalysis =
  | { readonly kind: 'zebra'; readonly stripes: number }
  | { readonly kind: 'curvature' }
  | { readonly kind: 'draft'; readonly pull: Vec3; readonly minimum: number };

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A colour ramp from blue (0) through green to red (1). */
export function ramp(t: number): Vec3 {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? [0, x * 2, 1 - x * 2] : [(x - 0.5) * 2, 1 - (x - 0.5) * 2, 0];
}

/** An RGB colour (0 … 1) for every vertex of the mesh. */
export function analysisColors(mesh: BodyMesh, analysis: SurfaceAnalysis): Float32Array {
  const count = mesh.positions.length / 3;
  const colors = new Float32Array(count * 3);
  const normal = (i: number): Vec3 => [mesh.normals[i * 3] as number, mesh.normals[i * 3 + 1] as number, mesh.normals[i * 3 + 2] as number];
  if (analysis.kind === 'zebra') {
    // Stripes by the angle of the normal from a fixed axis: smooth surfaces bend them smoothly, creases break them.
    const axis = unit([0.3, -0.5, 0.81]);
    for (let i = 0; i < count; i++) {
      const n = normal(i);
      const angle = Math.acos(Math.max(-1, Math.min(1, n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2])));
      const stripe = Math.floor((angle / Math.PI) * analysis.stripes * 2) % 2 === 0 ? 0.08 : 0.95;
      colors.set([stripe, stripe, stripe], i * 3);
    }
    return colors;
  }
  if (analysis.kind === 'draft') {
    const pull = unit(analysis.pull);
    const limit = Math.sin((analysis.minimum * Math.PI) / 180);
    for (let i = 0; i < count; i++) {
      const n = normal(i);
      const along = n[0] * pull[0] + n[1] * pull[1] + n[2] * pull[2];
      // Facing the pull: green; facing away: blue; nearly parallel to it (too little draft): yellow.
      colors.set(along >= limit ? [0.2, 0.75, 0.3] : along <= -limit ? [0.25, 0.45, 0.95] : [0.98, 0.8, 0.1], i * 3);
    }
    return colors;
  }
  // Curvature: how fast the normal turns between neighbouring vertices, per millimetre.
  const turn = new Float32Array(count);
  const seen = new Uint16Array(count);
  const position = (i: number): Vec3 => [mesh.positions[i * 3] as number, mesh.positions[i * 3 + 1] as number, mesh.positions[i * 3 + 2] as number];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const corners = [mesh.indices[t] as number, mesh.indices[t + 1] as number, mesh.indices[t + 2] as number];
    for (let k = 0; k < 3; k++) {
      const [a, b] = [corners[k] as number, corners[(k + 1) % 3] as number];
      const [pa, pb, na, nb] = [position(a), position(b), normal(a), normal(b)];
      const distance = Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      if (distance < 1e-9) continue;
      const k1 = Math.hypot(na[0] - nb[0], na[1] - nb[1], na[2] - nb[2]) / distance;
      for (const v of [a, b]) {
        turn[v] = (turn[v] as number) + k1;
        seen[v] = (seen[v] as number) + 1;
      }
    }
  }
  const values = Array.from(turn, (sum, i) => (seen[i] ? sum / (seen[i] as number) : 0));
  // Scaled to the most curved tenth, so one sharp fillet does not wash out the rest.
  const sorted = [...values].sort((a, b) => a - b);
  const top = Math.max(sorted[Math.floor(sorted.length * 0.9)] ?? 0, 1e-6);
  values.forEach((v, i) => colors.set(ramp(v / top), i * 3));
  return colors;
}
