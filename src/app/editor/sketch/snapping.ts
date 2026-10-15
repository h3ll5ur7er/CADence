import { type Sketch, type Vec2 } from '@core/contracts';
import { pointsOf } from '../../viewport/sketch-display';
import type { PointRef } from './sketch-tools';

/**
 * Where a click lands while drawing, and the relation the new point gets for it (docs/User-guide/Sketching.md#snapping):
 * an existing point is shared (coincident); a line's middle gets a midpoint relation; a point on a
 * line, circle or arc gets a point-on relation. Points win over middles, middles over curves.
 */
export function snap(sketch: Sketch, at: Vec2, pointReach: number, curveReach: number): PointRef {
  const points = pointsOf(sketch);
  const point = (id: string): Vec2 => points.get(id) ?? [0, 0];
  const gap = (p: Vec2) => Math.hypot(p[0] - at[0], p[1] - at[1]);

  let nearest: { ref: PointRef; d: number } | undefined;
  for (const [id, p] of points) {
    const d = gap(p);
    if (d <= pointReach && (!nearest || d < nearest.d)) nearest = { ref: { id, at: p }, d };
  }
  if (nearest) return nearest.ref;

  for (const e of sketch.entities) {
    if (e.kind !== 'line') continue;
    const [s, t] = [point(e.start), point(e.end)];
    const middle: Vec2 = [(s[0] + t[0]) / 2, (s[1] + t[1]) / 2];
    const d = gap(middle);
    if (d <= pointReach && (!nearest || d < nearest.d)) nearest = { ref: { at: middle, on: { kind: 'midpoint', id: e.id } }, d };
  }
  if (nearest) return nearest.ref;

  for (const e of sketch.entities) {
    let foot: Vec2 | undefined;
    if (e.kind === 'line') {
      const [s, t] = [point(e.start), point(e.end)];
      const d: Vec2 = [t[0] - s[0], t[1] - s[1]];
      const k = ((at[0] - s[0]) * d[0] + (at[1] - s[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1);
      if (k > 0 && k < 1) foot = [s[0] + k * d[0], s[1] + k * d[1]];
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      const c = point(e.center);
      const r = e.kind === 'circle' ? e.radius : Math.hypot(point(e.start)[0] - c[0], point(e.start)[1] - c[1]);
      const angle = Math.atan2(at[1] - c[1], at[0] - c[0]);
      const onArc = e.kind === 'circle' || withinArc(angle, Math.atan2(point(e.start)[1] - c[1], point(e.start)[0] - c[0]), Math.atan2(point(e.end)[1] - c[1], point(e.end)[0] - c[0]));
      if (onArc && r > 0) foot = [c[0] + r * Math.cos(angle), c[1] + r * Math.sin(angle)];
    }
    if (!foot) continue;
    const d = gap(foot);
    if (d <= curveReach && (!nearest || d < nearest.d)) nearest = { ref: { at: foot, on: { kind: 'curve', id: e.id } }, d };
  }
  return nearest?.ref ?? { at };
}

/** Whether `angle` lies on the counter-clockwise arc from `start` to `end`. */
function withinArc(angle: number, start: number, end: number): boolean {
  const ccw = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return ccw(start, angle) <= ccw(start, end);
}
