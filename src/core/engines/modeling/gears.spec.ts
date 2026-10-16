import { planetaryRatios, ringGearMesh, type Vec2 } from '@core/contracts';
import { describe, expect, it } from 'vitest';
import { fitFlank } from './gears';

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
