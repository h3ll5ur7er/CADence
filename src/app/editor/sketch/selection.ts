import { isDimension, type Sketch, type SketchConstraint, type SketchEntity, sketchOriginId, type Vec2 } from '@core/contracts';
import { curvePolyline, pointsOf } from '../../viewport/sketch-display';
import type { IdSource } from './sketch-tools';

/**
 * Selection helpers of the sketch editor (docs/User-guide/Sketching.md#select-copy-and-move): box
 * selection, and copy and paste of geometry with the relations among it.
 */

/** A dragged box: from left to right selects what lies inside it, from right to left what it touches. */
export function boxSelect(sketch: Sketch, from: Vec2, to: Vec2): string[] {
  const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
  const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
  const crossing = to[0] < from[0];
  const inside = (p: Vec2) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const points = pointsOf(sketch);
  const at = (id: string): Vec2 => points.get(id) ?? [0, 0];
  return sketch.entities.flatMap((e) => {
    if (e.kind === 'point') return inside(at(e.id)) ? [e.id] : [];
    if (e.kind === 'projection') return [];
    const polyline = curvePolyline(e, at);
    const hit = crossing ? polyline.some(inside) || polyline.slice(1).some((p, i) => crossesBox(polyline[i] as Vec2, p, x0, y0, x1, y1)) : polyline.every(inside);
    return hit ? [e.id] : [];
  });
}

/** Whether a segment crosses the box's outline (both ends may lie outside). */
function crossesBox(a: Vec2, b: Vec2, x0: number, y0: number, x1: number, y1: number): boolean {
  const corners: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return corners.some((c, i) => segmentsCross(a, b, c, corners[(i + 1) % 4] as Vec2));
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const side = (p: Vec2, q: Vec2, r: Vec2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
}

/** Geometry on the clipboard: entities with the points they use, and the relations among them. */
export interface SketchClipboard {
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

const referencesOf = (item: SketchEntity | SketchConstraint): string[] =>
  Object.entries(item).flatMap(([key, value]) => (key === 'id' || key === 'kind' || key === 'expression' ? [] : typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []));

/** The selected entities, the points their curves need, and the relations that only involve them (the sketch origin excepted). */
export function copySelection(sketch: Sketch, ids: readonly string[]): SketchClipboard | undefined {
  const chosen = new Set(ids);
  const curves = sketch.entities.filter((e) => chosen.has(e.id) && e.kind !== 'point');
  for (const curve of curves) for (const ref of referencesOf(curve)) chosen.add(ref);
  chosen.delete(sketchOriginId);
  const entities = sketch.entities.filter((e) => chosen.has(e.id));
  if (!entities.length) return undefined;
  const ownIds = new Set(entities.map((e) => e.id));
  const constraints = sketch.constraints.filter((c) => c.kind !== 'fix' && referencesOf(c).every((r) => ownIds.has(r)));
  return { entities, constraints };
}

/**
 * A copy of the clipboard with new ids, moved so its middle lands at `at`. Dimensions keep their
 * expressions, so a pasted copy follows the same parameters.
 */
export function pasted(clipboard: SketchClipboard, at: Vec2, newId: IdSource): SketchClipboard {
  const points = clipboard.entities.filter((e) => e.kind === 'point');
  const xs = points.map((p) => (p.kind === 'point' ? p.x : 0));
  const ys = points.map((p) => (p.kind === 'point' ? p.y : 0));
  const middle: Vec2 = xs.length ? [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2] : at;
  const [dx, dy] = [at[0] - middle[0], at[1] - middle[1]];
  const renamed = new Map<string, string>();
  for (const item of [...clipboard.entities, ...clipboard.constraints]) renamed.set(item.id, newId());
  const rename = <T extends SketchEntity | SketchConstraint>(item: T): T => {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (key === 'expression' || key === 'kind') copy[key] = value;
      else if (typeof value === 'string') copy[key] = renamed.get(value) ?? value;
      else if (Array.isArray(value)) copy[key] = value.map((v) => (typeof v === 'string' ? (renamed.get(v) ?? v) : v));
      else copy[key] = value;
    }
    return copy as T;
  };
  const entities = clipboard.entities.map((e) => {
    const copy = rename(e);
    return copy.kind === 'point' ? { ...copy, x: copy.x + dx, y: copy.y + dy } : copy;
  });
  const constraints = clipboard.constraints.map((c) => rename(c)).filter((c) => !isDimension(c) || c.expression !== '');
  return { entities, constraints };
}
