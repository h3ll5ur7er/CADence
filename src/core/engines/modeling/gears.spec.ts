import { bevelMesh, centreDistance, minimumProfileShift, planetaryRatios, ringGearMesh, type Vec2, wormMesh } from '@core/contracts';
import { describe, expect, it } from 'vitest';
import { fitFlank, gearTooth, type Piece, ringFillet } from './gears';

/** A point of a Bézier curve of any degree (de Casteljau). */
function bezierAt(controls: readonly Vec2[], t: number): Vec2 {
  let points = [...controls];
  while (points.length > 1) points = points.slice(1).map((p, i) => [(points[i] as Vec2)[0] + t * (p[0] - (points[i] as Vec2)[0]), (points[i] as Vec2)[1] + t * (p[1] - (points[i] as Vec2)[1])]);
  return points[0] as Vec2;
}

describe('planetary gear sets (CAD-98)', () => {
  it('place planets and give the carrier and planet ratios from the teeth', () => {
    // The radial engine's reduction: sun 24, planets 18, ring 60 (module 2).
    expect(ringGearMesh(2, 60, 18)).toEqual({ distance: 42, fits: true });
    expect(ringGearMesh(1, 30, 24).fits).toBe(false);
    const { carrier, planet } = planetaryRatios(24, 60);
    expect(carrier).toBeCloseTo(2 / 7, 12);
    expect(planet).toBeCloseTo(-20 / 21, 12);
  });
});

describe('gear flanks (CAD-107)', () => {
  it('follow the involute within 0.003 module, for few and many teeth', () => {
    const angle = (20 * Math.PI) / 180;
    for (const teeth of [6, 12, 28, 60, 96]) {
      const pitch = teeth / 2; // module 1
      const base = pitch * Math.cos(angle);
      const involute = (a: number) => Math.tan(a) - a;
      const half = (rho: number) => Math.PI / (2 * teeth) + involute(angle) - involute(Math.acos(Math.min(1, base / rho)));
      const flank = (rho: number): Vec2 => [rho * Math.cos(-half(rho)), rho * Math.sin(-half(rho))];
      const [from, to] = [Math.max(base, pitch - 1.25), pitch + 1];
      const controls = fitFlank(flank, base, from, to);
      const curve = Array.from({ length: 2001 }, (_, i) => bezierAt(controls, i / 2000));
      let worst = 0;
      for (let i = 0; i <= 200; i++) {
        const p = flank(from + ((to - from) * i) / 200);
        worst = Math.max(worst, Math.min(...curve.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
      }
      expect(worst).toBeLessThan(0.003);
    }
  });
});

/** A tooth's outline as points: its pieces sampled finely, from `first`. */
function sampled(first: Vec2, pieces: readonly Piece[]): Vec2[] {
  const points: Vec2[] = [first];
  let at = first;
  for (const piece of pieces) {
    if (piece.kind === 'line') {
      for (let i = 1; i <= 40; i++) points.push([at[0] + ((piece.end[0] - at[0]) * i) / 40, at[1] + ((piece.end[1] - at[1]) * i) / 40]);
    } else if (piece.kind === 'bezier') {
      const controls = [at, ...piece.controls, piece.end];
      for (let i = 1; i <= 200; i++) points.push(bezierAt(controls, i / 200));
    } else {
      // The circle through the three points, from the start through `via` to the end.
      const [a, b, c] = [at, piece.via, piece.end];
      const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
      const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
      const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
      const r = Math.hypot(a[0] - ux, a[1] - uy);
      const angle = (p: Vec2) => Math.atan2(p[1] - uy, p[0] - ux);
      const [from, through, to] = [angle(a), angle(b), angle(c)];
      const span = (x: number) => (((x - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const sweep = span(through) <= span(to) ? span(to) : span(to) - 2 * Math.PI;
      for (let i = 1; i <= 60; i++) points.push([ux + r * Math.cos(from + (sweep * i) / 60), uy + r * Math.sin(from + (sweep * i) / 60)]);
    }
    at = piece.end;
  }
  return points;
}

/** Whether a point lies inside a polygon (even-odd). */
function inside(p: Vec2, polygon: readonly Vec2[]): boolean {
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [a, b] = [polygon[i] as Vec2, polygon[j] as Vec2];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) odd = !odd;
  }
  return odd;
}

/** How far a point lies from a polyline (the nearest of its segments). */
function distance(p: Vec2, line: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1] as Vec2, line[i] as Vec2];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}

/**
 * How deep the rack that cuts a gear (its straight flanks, down to the working depth: the mating
 * teeth's reach) runs into one of its teeth as the gear rolls on it: undercut when deeper than nothing.
 */
function rackInterference(teeth: number, shift: number): number {
  const [m, alpha] = [1, Math.PI / 9];
  const { first, pieces } = gearTooth(m, teeth, alpha, shift);
  const outline = sampled(first, pieces);
  const tooth: Vec2[] = [[0, 0], ...outline];
  const pitch = (m * teeth) / 2;
  // The rack's reference line, x·m out from the pitch circle; its teeth point towards the gear's centre.
  const reference = pitch + shift * m;
  const slope = Math.tan(alpha);
  let deepest = 0;
  for (let step = -60; step <= 60; step++) {
    const roll = (step / 60) * (Math.PI / 2.5);
    // In the gear's frame: the rack rolled by `roll` (it moves pitch · roll along y), turned back by the roll.
    const [cos, sin] = [Math.cos(-roll), Math.sin(-roll)];
    const place = ([x, y]: Vec2): Vec2 => [x * cos - y * sin, x * sin + y * cos];
    for (let k = -2; k <= 1; k++) {
      const centre = (k + 0.5) * Math.PI * m + pitch * roll;
      // Along both flanks from the tip line down to the rack's root.
      for (let i = 0; i <= 80; i++) {
        const depth = -m + (2.25 * m * i) / 80;
        const half = (Math.PI * m) / 4 + depth * slope;
        for (const side of [-1, 1]) {
          const p = place([reference + depth, centre + side * half]);
          if (inside(p, tooth)) deepest = Math.max(deepest, distance(p, outline));
        }
      }
    }
  }
  return deepest;
}

describe('profile shift (CAD-159)', () => {
  it('keeps a gear of 8 teeth free of undercut with a shift', () => {
    // 8 teeth at 20° need x ≥ 1 − 8 sin²20° / 2 = 0.532.
    expect(minimumProfileShift(8, Math.PI / 9)).toBeCloseTo(0.532, 3);
    expect(minimumProfileShift(17, Math.PI / 9)).toBeLessThan(0.01);
    // Unshifted, the rack's flanks run 0.05 module into the teeth's roots: they would be undercut.
    expect(rackInterference(8, 0)).toBeGreaterThan(0.03);
    // Shifted by 0.55 module, no deeper than the flank curves stray from the involute (0.003 module) and sampling.
    expect(rackInterference(8, 0.55)).toBeLessThan(0.005);
  });

  it('gives the centre distance of shifted gears', () => {
    expect(centreDistance(2, 8, 20)).toBe(28);
    // A pinion shifted out and a gear shifted in by as much: the same distance (x₁ + x₂ = 0).
    expect(centreDistance(2, 8, 20, 0.55, -0.55, Math.PI / 9)).toBeCloseTo(28, 12);
    // Only the pinion out: a working pressure angle of 24.8°, the gears 0.98 mm further apart.
    expect(centreDistance(2, 8, 20, 0.55, 0, Math.PI / 9)).toBeCloseTo(28.9832, 3);
  });
});

describe('ring gear root fillets (CAD-159)', () => {
  it('touch the flank beyond the planets\' tips and the root circle, at most 0.38 module', () => {
    const [m, z, alpha] = [2, 60, Math.PI / 9];
    const pitch = (m * z) / 2;
    const base = pitch * Math.cos(alpha);
    const half = (rho: number) => Math.PI / (2 * z) + Math.tan(alpha) - alpha - (Math.tan(Math.acos(base / rho)) - Math.acos(base / rho));
    const fillet = ringFillet(pitch + m, pitch + 1.25 * m, m, half, base);
    expect(fillet).toBeDefined();
    const { touch, radius, angle } = fillet as NonNullable<typeof fillet>;
    expect(touch).toBeGreaterThanOrEqual(pitch + m);
    expect(radius).toBeGreaterThan(0.1 * m);
    expect(radius).toBeLessThanOrEqual(0.38 * m);
    // Its touch on the root circle lies inside the space, before its middle.
    expect(angle).toBeGreaterThan(0);
    expect(angle).toBeLessThan(half(pitch + 1.25 * m));
  });
});

describe('bevel and worm gear meshes (CAD-160)', () => {
  it('place a bevel gear\'s mate from its pitch cones', () => {
    // 20 and 30 teeth at 90°: tan δ₁ = 20 / 30.
    const mesh = bevelMesh(2, 20, 30, Math.PI / 2);
    expect(mesh.pitchAngle).toBeCloseTo(Math.atan(20 / 30), 12);
    expect(mesh.pitchAngle + mesh.matePitchAngle).toBeCloseTo(Math.PI / 2, 12);
    // Both cones share their apex: 30 mm up this gear's axis, 20 mm along the mate's.
    expect(mesh.apex).toBeCloseTo(30, 9);
    expect(mesh.mateApex).toBeCloseTo(20, 9);
    expect(mesh.mate).toEqual([expect.closeTo(20, 9), expect.closeTo(30, 9)]);
    expect(mesh.ratio).toBeCloseTo(-2 / 3, 12);
    // At 60° the cones still meet at one apex.
    const leaning = bevelMesh(1, 20, 20, Math.PI / 3);
    expect(leaning.pitchAngle).toBeCloseTo(Math.PI / 6, 12);
  });

  it('place a worm\'s wheel from the lead angle', () => {
    // One start at 6°: d = 1.5 / tan 6° = 14.27 mm; the wheel's 45 mm.
    const mesh = wormMesh(1.5, 1, Math.PI / 30, 30);
    expect(mesh.worm).toBeCloseTo(14.2715, 3);
    expect(mesh.distance).toBeCloseTo((14.2715 + 45) / 2, 3);
    expect(mesh.ratio).toBeCloseTo(1 / 30, 12);
  });
});
