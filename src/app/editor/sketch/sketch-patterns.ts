import { type Sketch, type SketchConstraint, type SketchEntity, type SketchLine, sketchOriginId, type Vec2 } from '@core/contracts';
import type { DesignCommand } from '@core/managers/design';
import { pointsOf } from '../../viewport/sketch-display';
import { copySelection, pasted, type SketchClipboard } from './selection';
import type { IdSource } from './sketch-tools';

/**
 * Mirror and pattern of sketch geometry (docs/User-guide/Sketching.md#mirror-and-patterns). The
 * copies stay related to the originals: a mirror image through symmetric relations, pattern copies
 * through their own relations and dimensions that place them.
 */

type Geometry = Extract<DesignCommand, { type: 'add-sketch-geometry' }>;

const round = (v: number) => String(Math.round(v * 1e4) / 1e4);

/** The selected geometry without the given ids, with what it needs. */
function selectionWithout(sketch: Sketch, ids: readonly string[], except: string): SketchClipboard | undefined {
  return copySelection(sketch, ids.filter((id) => id !== except));
}

/**
 * Mirrors the selection across a line. Points on the line are shared; every other point gets a
 * mirrored twin held by a symmetric relation, circles an equal one. Arcs turn the other way round.
 */
export function mirrorCommand(sketch: Sketch, ids: readonly string[], axis: string, newId: IdSource): Geometry | undefined {
  const line = sketch.entities.find((e): e is SketchLine => e.id === axis && e.kind === 'line');
  const clipboard = line && selectionWithout(sketch, ids, axis);
  if (!line || !clipboard) return undefined;
  const points = pointsOf(sketch);
  const [a, b] = [points.get(line.start) ?? [0, 0], points.get(line.end) ?? [0, 0]];
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(d[0], d[1]);
  if (length < 1e-9) return undefined;
  const reflect = (p: Vec2): Vec2 => {
    const k = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (length * length);
    const foot: Vec2 = [a[0] + k * d[0], a[1] + k * d[1]];
    return [2 * foot[0] - p[0], 2 * foot[1] - p[1]];
  };
  const onAxis = (p: Vec2) => Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / length < 1e-6;
  const twin = new Map<string, string>([[sketchOriginId, sketchOriginId]]);
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  for (const e of clipboard.entities) {
    if (e.kind !== 'point') continue;
    const p: Vec2 = [e.x, e.y];
    if (onAxis(p)) {
      twin.set(e.id, e.id);
      continue;
    }
    const id = newId();
    const [x, y] = reflect(p);
    twin.set(e.id, id);
    entities.push({ id, kind: 'point', x, y });
    constraints.push({ id: newId(), kind: 'symmetric', points: [e.id, id], line: axis });
  }
  const to = (id: string) => twin.get(id) ?? id;
  for (const e of clipboard.entities) {
    const id = newId();
    switch (e.kind) {
      case 'line':
        entities.push({ ...e, id, start: to(e.start), end: to(e.end) });
        break;
      case 'circle':
        entities.push({ ...e, id, center: to(e.center) });
        constraints.push({ id: newId(), kind: 'equal', curves: [e.id, id] });
        break;
      case 'arc':
        // A mirror image runs the other way round: counter-clockwise from the twin of the end.
        entities.push({ ...e, id, center: to(e.center), start: to(e.end), end: to(e.start) });
        break;
      case 'ellipse':
        entities.push({ ...e, id, center: to(e.center), major: to(e.major) });
        break;
      case 'spline':
        entities.push({ ...e, id, points: e.points.map(to) });
        break;
      default:
        break;
    }
  }
  return { type: 'add-sketch-geometry', sketchId: sketch.id, entities, constraints };
}

/** Relations that hold only in the original orientation, which a turned copy cannot keep. */
const oriented = (c: SketchConstraint) => c.kind === 'horizontal' || c.kind === 'vertical' || c.kind === 'horizontal-points' || c.kind === 'vertical-points';

/** The point a copy is placed by: the first point of the selection. */
const anchorOf = (clipboard: SketchClipboard): string | undefined => clipboard.entities.find((e) => e.kind === 'point')?.id;

/**
 * `count` copies in a row (the original counts), each `step` further. A copy keeps the relations
 * among its curves; its first point is placed from the original's by dimensions (k × step).
 */
export function linearPatternCommand(sketch: Sketch, ids: readonly string[], count: number, step: Vec2, newId: IdSource): Geometry | undefined {
  const clipboard = copySelection(sketch, ids);
  const anchor = clipboard && anchorOf(clipboard);
  if (!clipboard || !anchor || count < 2 || (step[0] === 0 && step[1] === 0)) return undefined;
  const middle = middleOf(clipboard);
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  for (let k = 1; k < count; k++) {
    const { copy, renamed } = placedCopy(clipboard, [middle[0] + k * step[0], middle[1] + k * step[1]], newId);
    entities.push(...copy.entities);
    constraints.push(
      ...copy.constraints,
      { id: newId(), kind: 'horizontal-distance', points: [anchor, renamed(anchor)], expression: round(k * step[0]) },
      { id: newId(), kind: 'vertical-distance', points: [anchor, renamed(anchor)], expression: round(k * step[1]) },
    );
  }
  return { type: 'add-sketch-geometry', sketchId: sketch.id, entities, constraints };
}

/**
 * `count` copies around `center` (the original counts), evenly over a full turn. A copy keeps the
 * relations among its curves that do not depend on its orientation; construction lines from the
 * centre, of equal length and at the pattern angle, place its first point.
 */
export function circularPatternCommand(sketch: Sketch, ids: readonly string[], count: number, center: string, newId: IdSource): Geometry | undefined {
  const clipboard = copySelection(sketch, ids.filter((id) => id !== center));
  const anchor = clipboard && anchorOf(clipboard);
  const c = pointsOf(sketch).get(center);
  if (!clipboard || !anchor || !c || count < 2) return undefined;
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const spoke = newId();
  entities.push({ id: spoke, kind: 'line', start: center, end: anchor, construction: true });
  for (let k = 1; k < count; k++) {
    const angle = (2 * Math.PI * k) / count;
    const turn = (p: Vec2): Vec2 => {
      const [x, y] = [p[0] - c[0], p[1] - c[1]];
      return [c[0] + x * Math.cos(angle) - y * Math.sin(angle), c[1] + x * Math.sin(angle) + y * Math.cos(angle)];
    };
    const renamed = new Map(clipboard.entities.map((e) => [e.id, newId()]));
    const to = (id: string) => renamed.get(id) ?? id;
    for (const e of clipboard.entities) {
      const copy = renameRefs(e, to);
      entities.push(copy.kind === 'point' ? { ...copy, ...xy(turn([e.kind === 'point' ? e.x : 0, e.kind === 'point' ? e.y : 0])) } : copy);
    }
    constraints.push(...clipboard.constraints.filter((x) => !oriented(x)).map((x) => ({ ...renameRefs(x, to), id: newId() })));
    const arm = newId();
    entities.push({ id: arm, kind: 'line', start: center, end: to(anchor), construction: true });
    constraints.push(
      { id: newId(), kind: 'equal', curves: [spoke, arm] },
      { id: newId(), kind: 'angle', lines: [spoke, arm], expression: `${round((360 * k) / count)} deg` },
    );
  }
  return { type: 'add-sketch-geometry', sketchId: sketch.id, entities, constraints };
}

const xy = ([x, y]: Vec2) => ({ x, y });

function middleOf(clipboard: SketchClipboard): Vec2 {
  const points = clipboard.entities.flatMap((e) => (e.kind === 'point' ? [[e.x, e.y] as Vec2] : []));
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

/** A pasted copy centred at `at`, with the map from original ids to the copy's. */
function placedCopy(clipboard: SketchClipboard, at: Vec2, newId: IdSource): { copy: SketchClipboard; renamed: (id: string) => string } {
  const ids: string[] = [];
  const copy = pasted(clipboard, at, () => {
    const id = newId();
    ids.push(id);
    return id;
  });
  const order = [...clipboard.entities, ...clipboard.constraints].map((item) => item.id);
  const map = new Map(order.map((id, i) => [id, ids[i] as string]));
  return { copy, renamed: (id) => map.get(id) ?? id };
}

/** A copy of an entity or constraint with its references renamed. */
function renameRefs<T extends SketchEntity | SketchConstraint>(item: T, to: (id: string) => string): T {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === 'kind' || key === 'expression') copy[key] = value;
    else if (typeof value === 'string') copy[key] = to(value);
    else if (Array.isArray(value)) copy[key] = value.map((v) => (typeof v === 'string' ? to(v) : v));
    else copy[key] = value;
  }
  return copy as T;
}
