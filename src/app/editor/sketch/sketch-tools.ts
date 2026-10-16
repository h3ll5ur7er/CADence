import {
  type Dimension,
  type GeometricConstraint,
  type LengthUnit,
  lengthExpression,
  lengthUnitSize,
  type Sketch,
  type SketchConstraint,
  type SketchEntity,
  type TextWeight,
  type Vec2,
} from '@core/contracts';
import type { DesignCommand } from '@core/managers/design';
import { pointsOf } from '../../viewport/sketch-display';
import type { ShapeTool } from './shape-tools';

/** Tools that change existing curves with a click: on a curve (trim, extend, split) or on a corner (fillet, chamfer). */
export type EditTool = 'trim' | 'extend' | 'split' | 'fillet' | 'chamfer';
export const editTools: readonly EditTool[] = ['trim', 'extend', 'split', 'fillet', 'chamfer'];
export const isEditTool = (tool: string): tool is EditTool => (editTools as readonly string[]).includes(tool);

/** Tools that move the selection: by a base point and a target, or turned about a centre. */
export type TransformTool = 'move' | 'rotate';

/** Tools that copy the selection: across a line clicked next, or around a point clicked next. */
export type CopyTool = 'mirror' | 'circular-pattern';

export type Tool = 'select' | 'line' | 'rectangle' | 'circle' | 'arc' | 'point' | 'dimension' | 'project' | 'text' | ShapeTool | EditTool | TransformTool | CopyTool;

/** What the text tool places. */
export interface TextDraft {
  readonly text: string;
  readonly height: number;
  readonly weight: TextWeight;
  /** An imported font document; absent: the bundled one. */
  readonly font?: string;
}

/** A text whose baseline starts where the click lands. */
export function textCommand(sketchId: string, at: PointRef, draft: TextDraft, newId: IdSource): Geometry | undefined {
  if (!draft.text.trim() || !(draft.height > 0)) return undefined;
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const anchor = resolvePoint(at, newId, entities, constraints);
  entities.push({ id: newId(), kind: 'text', anchor, text: draft.text, height: draft.height, weight: draft.weight, angle: 0, construction: false, ...(draft.font ? { font: draft.font } : {}) });
  return { type: 'add-sketch-geometry', sketchId, entities, constraints };
}

/**
 * A position a tool clicked: snapped to an existing point (`id`), or free; a free position snapped onto
 * a curve or a line's middle (`on`) gives the new point that relation.
 */
export interface PointRef {
  readonly id?: string;
  readonly at: Vec2;
  readonly on?: { readonly kind: 'curve' | 'midpoint'; readonly id: string };
}

export type IdSource = () => string;

type Geometry = Extract<DesignCommand, { type: 'add-sketch-geometry' }>;

/** Lines within this angle of an axis become horizontal or vertical. */
const inferenceAngle = (3 * Math.PI) / 180;

/** Plain number for a dimension's initial expression: the current value, rounded to 0.01. */
export const formatValue = (value: number): string => String(Math.round(value * 100) / 100);

/** The point a click stands for: the snapped one, or a new one with the relation it snapped to. */
export function resolvePoint(ref: PointRef, newId: IdSource, entities: SketchEntity[], constraints: SketchConstraint[]): string {
  if (ref.id) return ref.id;
  const id = newId();
  entities.push({ id, kind: 'point', x: ref.at[0], y: ref.at[1] });
  if (ref.on?.kind === 'curve') constraints.push({ id: newId(), kind: 'point-on', point: id, curve: ref.on.id });
  if (ref.on?.kind === 'midpoint') constraints.push({ id: newId(), kind: 'midpoint', point: id, line: ref.on.id });
  return id;
}

/** Horizontal or vertical when a line is drawn close to an axis. */
export function inferAxis(from: Vec2, to: Vec2): 'horizontal' | 'vertical' | undefined {
  const dx = Math.abs(to[0] - from[0]);
  const dy = Math.abs(to[1] - from[1]);
  if (dx === 0 && dy === 0) return undefined;
  if (dy <= Math.tan(inferenceAngle) * dx) return 'horizontal';
  if (dx <= Math.tan(inferenceAngle) * dy) return 'vertical';
  return undefined;
}

export function lineCommand(
  sketchId: string,
  from: PointRef,
  to: PointRef,
  newId: IdSource,
  infer = true,
): { command: Geometry; end: string } {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const start = resolvePoint(from, newId, entities, constraints);
  const end = resolvePoint(to, newId, entities, constraints);
  const line = newId();
  entities.push({ id: line, kind: 'line', start, end, construction: false });
  const axis = infer ? inferAxis(from.at, to.at) : undefined;
  if (axis) constraints.push({ id: newId(), kind: axis, line });
  return { command: { type: 'add-sketch-geometry', sketchId, entities, constraints }, end };
}

/** Four lines between two opposite corners, kept rectangular by horizontal and vertical relations. */
export function rectangleCommand(sketchId: string, a: PointRef, c: PointRef, newId: IdSource): Geometry {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const pa = resolvePoint(a, newId, entities, constraints);
  const pb = resolvePoint({ at: [c.at[0], a.at[1]] }, newId, entities, constraints);
  const pc = resolvePoint(c, newId, entities, constraints);
  const pd = resolvePoint({ at: [a.at[0], c.at[1]] }, newId, entities, constraints);
  const [bottom, right, top, left] = [newId(), newId(), newId(), newId()] as [string, string, string, string];
  entities.push(
    { id: bottom, kind: 'line', start: pa, end: pb, construction: false },
    { id: right, kind: 'line', start: pb, end: pc, construction: false },
    { id: top, kind: 'line', start: pc, end: pd, construction: false },
    { id: left, kind: 'line', start: pd, end: pa, construction: false },
  );
  return {
    type: 'add-sketch-geometry',
    sketchId,
    entities,
    constraints: [
      ...constraints,
      { id: newId(), kind: 'horizontal', line: bottom },
      { id: newId(), kind: 'horizontal', line: top },
      { id: newId(), kind: 'vertical', line: right },
      { id: newId(), kind: 'vertical', line: left },
    ],
  };
}

export function circleCommand(sketchId: string, center: PointRef, radius: number, newId: IdSource): Geometry {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const c = resolvePoint(center, newId, entities, constraints);
  entities.push({ id: newId(), kind: 'circle', center: c, radius, construction: false });
  return { type: 'add-sketch-geometry', sketchId, entities, constraints };
}

/** Arc around `center` from `start`, ending at the direction of `end`; always the counter-clockwise side. */
export function arcCommand(sketchId: string, center: PointRef, start: Vec2, end: Vec2, newId: IdSource): Geometry {
  const entities: SketchEntity[] = [];
  const constraints: SketchConstraint[] = [];
  const c = resolvePoint(center, newId, entities, constraints);
  const radius = Math.hypot(start[0] - center.at[0], start[1] - center.at[1]);
  const angle = Math.atan2(end[1] - center.at[1], end[0] - center.at[0]);
  const endAt: Vec2 = [center.at[0] + radius * Math.cos(angle), center.at[1] + radius * Math.sin(angle)];
  const s = resolvePoint({ at: start }, newId, entities, constraints);
  const e = resolvePoint({ at: endAt }, newId, entities, constraints);
  entities.push({ id: newId(), kind: 'arc', center: c, start: s, end: e, construction: false });
  return { type: 'add-sketch-geometry', sketchId, entities, constraints };
}

export function pointCommand(sketchId: string, at: Vec2, newId: IdSource): Geometry {
  return { type: 'add-sketch-geometry', sketchId, entities: [{ id: newId(), kind: 'point', x: at[0], y: at[1] }], constraints: [] };
}

export type ConstraintTool =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'collinear'
  | 'equal'
  | 'tangent'
  | 'concentric'
  | 'midpoint'
  | 'symmetric'
  | 'fix';

const isRound = (e: SketchEntity | undefined) => e?.kind === 'circle' || e?.kind === 'arc';

/** The constraint a tool makes from the selected entities, or undefined when the selection does not fit. */
export function constraintFor(
  tool: ConstraintTool,
  selected: readonly SketchEntity[],
  id: string,
  sketch: Sketch,
): GeometricConstraint | undefined {
  const single = selected.length === 1 ? selected[0] : undefined;
  const pair = selected.length === 2 ? (selected as readonly [SketchEntity, SketchEntity]) : undefined;
  const pointOf = (entities: readonly SketchEntity[]) => entities.find((e) => e.kind === 'point');
  const otherThan = (entities: readonly SketchEntity[], kind: SketchEntity['kind']) => entities.find((e) => e.kind !== kind);
  switch (tool) {
    case 'coincident': {
      if (!pair) return undefined;
      const [a, b] = pair;
      if (a.kind === 'point' && b.kind === 'point') return { id, kind: 'coincident', points: [a.id, b.id] };
      const point = pointOf(pair);
      const curve = otherThan(pair, 'point');
      // Points can lie on lines, circles and arcs (not yet on ellipses and splines).
      return point && curve && (curve.kind === 'line' || isRound(curve)) ? { id, kind: 'point-on', point: point.id, curve: curve.id } : undefined;
    }
    case 'horizontal':
    case 'vertical':
      if (single?.kind === 'line') return { id, kind: tool, line: single.id };
      // Two points: level with each other, or one above the other.
      return pair?.[0].kind === 'point' && pair[1].kind === 'point' ? { id, kind: tool === 'horizontal' ? 'horizontal-points' : 'vertical-points', points: [pair[0].id, pair[1].id] } : undefined;
    case 'collinear':
      return pair?.[0].kind === 'line' && pair[1].kind === 'line' ? { id, kind: 'collinear', lines: [pair[0].id, pair[1].id] } : undefined;
    case 'concentric': {
      const centred = (e: SketchEntity) => isRound(e) || e.kind === 'ellipse';
      return pair && centred(pair[0]) && centred(pair[1]) ? { id, kind: 'concentric', curves: [pair[0].id, pair[1].id] } : undefined;
    }
    case 'symmetric': {
      if (selected.length !== 3) return undefined;
      const points = selected.filter((e) => e.kind === 'point');
      const line = selected.find((e) => e.kind === 'line');
      return points.length === 2 && line ? { id, kind: 'symmetric', points: [(points[0] as SketchEntity).id, (points[1] as SketchEntity).id], line: line.id } : undefined;
    }
    case 'parallel':
    case 'perpendicular':
      return pair?.[0].kind === 'line' && pair[1].kind === 'line' ? { id, kind: tool, lines: [pair[0].id, pair[1].id] } : undefined;
    case 'equal': {
      if (!pair) return undefined;
      const [a, b] = pair;
      const lines = a.kind === 'line' && b.kind === 'line';
      return lines || (isRound(a) && isRound(b)) ? { id, kind: 'equal', curves: [a.id, b.id] } : undefined;
    }
    case 'tangent': {
      if (!pair) return undefined;
      const [a, b] = pair;
      const fits = (isRound(a) || isRound(b)) && a.kind !== 'point' && b.kind !== 'point';
      return fits ? { id, kind: 'tangent', curves: [a.id, b.id] } : undefined;
    }
    case 'midpoint': {
      if (!pair) return undefined;
      const point = pointOf(pair);
      const line = pair.find((e) => e.kind === 'line');
      return point && line ? { id, kind: 'midpoint', point: point.id, line: line.id } : undefined;
    }
    case 'fix': {
      if (single?.kind !== 'point') return undefined;
      const at = pointsOf(sketch).get(single.id) ?? [single.x, single.y];
      return { id, kind: 'fix', point: single.id, x: at[0], y: at[1] };
    }
  }
}

/**
 * The dimension for one or two picked entities, initialised to the current value:
 * line → length, circle → diameter, arc → radius, ellipse → minor radius, two points → distance,
 * point and line → distance, two lines → angle.
 */
export function dimensionFor(selected: readonly SketchEntity[], id: string, sketch: Sketch, unit: LengthUnit = 'mm'): Dimension | undefined {
  // Lengths start at their current value in the document's unit.
  const formatValue = (mm: number) => lengthExpression(String(Math.round((mm / lengthUnitSize[unit]) * 100) / 100), unit);
  const points = pointsOf(sketch);
  const at = (pointId: string) => points.get(pointId) ?? ([0, 0] as Vec2);
  const dist = (p: string, q: string) => Math.hypot(at(p)[0] - at(q)[0], at(p)[1] - at(q)[1]);
  const [a, b] = selected;
  if (selected.length === 1 && a) {
    if (a.kind === 'line') return { id, kind: 'distance', points: [a.start, a.end], expression: formatValue(dist(a.start, a.end)) };
    if (a.kind === 'circle') return { id, kind: 'diameter', curve: a.id, expression: formatValue(2 * a.radius) };
    if (a.kind === 'arc') return { id, kind: 'radius', curve: a.id, expression: formatValue(dist(a.center, a.start)) };
    if (a.kind === 'ellipse') return { id, kind: 'radius', curve: a.id, expression: formatValue(a.minorRadius) };
    return undefined;
  }
  if (selected.length !== 2 || !a || !b) return undefined;
  if (a.kind === 'point' && b.kind === 'point') return { id, kind: 'distance', points: [a.id, b.id], expression: formatValue(dist(a.id, b.id)) };
  if (a.kind === 'line' && b.kind === 'line') {
    const direction = (l: typeof a) => Math.atan2(at(l.end)[1] - at(l.start)[1], at(l.end)[0] - at(l.start)[0]);
    let angle = Math.abs(direction(b) - direction(a)) % Math.PI;
    if (angle > Math.PI / 2) angle = Math.PI - angle;
    return { id, kind: 'angle', lines: [a.id, b.id], expression: `${String(Math.round(((angle * 180) / Math.PI) * 100) / 100)} deg` };
  }
  const point = selected.find((e) => e.kind === 'point');
  const line = selected.find((e) => e.kind === 'line');
  if (point && line?.kind === 'line') {
    const [p, s, e] = [at(point.id), at(line.start), at(line.end)];
    const distance = Math.abs((e[0] - s[0]) * (s[1] - p[1]) - (s[0] - p[0]) * (e[1] - s[1])) / Math.hypot(e[0] - s[0], e[1] - s[1]);
    return { id, kind: 'point-line-distance', point: point.id, line: line.id, expression: formatValue(distance) };
  }
  return undefined;
}
