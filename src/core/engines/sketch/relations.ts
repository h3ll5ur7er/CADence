import type { SketchConstraint, SketchEntity, Vec2 } from '@core/contracts';

/** What an inserted drawing is held by: nothing, the relations it already shows, or fixed where it is. */
export type DrawingRelations = 'none' | 'infer' | 'fix';

/** Directions within this angle count as the same (radians, about 0.06°). */
const angleTolerance = 1e-3;

/**
 * Constraints for imported geometry. `infer` adds what the drawing already shows: lines that run
 * horizontal or vertical, and lines and arcs that meet smoothly at a shared end (tangent). Shared ends
 * are already one point, so coincidence needs no constraint. `fix` pins every point where it is.
 */
export function inferRelations(entities: readonly SketchEntity[], mode: DrawingRelations, idPrefix: string): SketchConstraint[] {
  let n = 0;
  const id = () => `${idPrefix}r${n++}`;
  const points = new Map<string, Vec2>(entities.flatMap((e): [string, Vec2][] => (e.kind === 'point' ? [[e.id, [e.x, e.y]]] : [])));
  if (mode === 'none') return [];
  if (mode === 'fix') {
    return entities.flatMap((e): SketchConstraint[] => (e.kind === 'point' ? [{ id: id(), kind: 'fix', point: e.id, x: e.x, y: e.y }] : []));
  }
  const at = (p: string): Vec2 => points.get(p) ?? [0, 0];
  const constraints: SketchConstraint[] = [];
  for (const e of entities) {
    if (e.kind !== 'line') continue;
    const [a, b] = [at(e.start), at(e.end)];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const off = (target: number) => Math.abs(Math.sin(angle - target));
    if (off(0) < angleTolerance) constraints.push({ id: id(), kind: 'horizontal', line: e.id });
    else if (off(Math.PI / 2) < angleTolerance) constraints.push({ id: id(), kind: 'vertical', line: e.id });
  }
  // The direction a line or arc leaves a shared end in, if it has that end.
  const direction = (e: SketchEntity, point: string): Vec2 | undefined => {
    if (e.kind === 'line' && (e.start === point || e.end === point)) {
      const [a, b] = [at(e.start), at(e.end)];
      return [b[0] - a[0], b[1] - a[1]];
    }
    if (e.kind === 'arc' && (e.start === point || e.end === point)) {
      const [c, p] = [at(e.center), at(point)];
      return [-(p[1] - c[1]), p[0] - c[0]];
    }
    return undefined;
  };
  const curves = entities.filter((e) => e.kind === 'line' || e.kind === 'arc');
  for (const [i, first] of curves.entries()) {
    for (const second of curves.slice(i + 1)) {
      if (first.kind === 'line' && second.kind === 'line') continue;
      const shared = [...points.keys()].find((p) => direction(first, p) && direction(second, p));
      if (!shared) continue;
      const [u, v] = [direction(first, shared) as Vec2, direction(second, shared) as Vec2];
      const cross = (u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
      if (Math.abs(cross) < angleTolerance) constraints.push({ id: id(), kind: 'tangent', curves: [first.id, second.id] });
    }
  }
  return constraints;
}
