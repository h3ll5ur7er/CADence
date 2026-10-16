import { generatorOf, isDimension, type PointFreedom, type Sketch, type SketchConstraint, type SketchEntity, type SketchFreedom, sketchOriginId, type Vec2 } from '@core/contracts';
import type { PlanegcsSolver } from './planegcs-solver';

const length = (v: Vec2) => Math.hypot(v[0], v[1]);

/** The points that solving does not hold in place (the sketch is pulled at each, along x and along y). */
export async function sketchFreedom(solver: PlanegcsSolver, sketch: Sketch, values: ReadonlyMap<string, number>): Promise<SketchFreedom> {
  const solved = await solver.solve(sketch, values);
  if (solved.status !== 'under-constrained') return { points: [], radii: [] };
  const base = solved.sketch;
  const extent = Math.max(1, ...base.entities.flatMap((e) => (e.kind === 'point' ? [Math.abs(e.x), Math.abs(e.y)] : [])));
  const step = extent * 0.02;
  const points: PointFreedom[] = [];
  for (const point of base.entities) {
    if (point.kind !== 'point' || generatorOf(base, point.id)) continue;
    const moves: Vec2[] = [];
    for (const direction of [[1, 0], [0, 1]] as const) {
      const pulled = await solver.solve(base, values, { point: point.id, x: point.x + direction[0] * step, y: point.y + direction[1] * step });
      const moved = pulled.sketch.entities.find((e) => e.id === point.id);
      if (moved?.kind !== 'point') continue;
      const d: Vec2 = [moved.x - point.x, moved.y - point.y];
      if (length(d) > step * 0.05) moves.push(d);
    }
    if (!moves.length) continue;
    const [a, b] = moves as [Vec2, Vec2 | undefined];
    const independent = b && Math.abs(a[0] * b[1] - a[1] * b[0]) > 0.2 * length(a) * length(b);
    const unit = (v: Vec2): Vec2 => [v[0] / length(v), v[1] / length(v)];
    points.push({ point: point.id, directions: independent ? [[1, 0], [0, 1]] : [unit(a)] });
  }
  // A circle's radius is its own freedom; it is set by a radius, diameter, equal or tangent relation, or a point on it.
  const sized = new Set(
    base.constraints.flatMap((c) =>
      c.kind === 'radius' || c.kind === 'diameter' ? [c.curve] : c.kind === 'equal' || c.kind === 'tangent' ? [...c.curves] : c.kind === 'point-on' ? [c.curve] : [],
    ),
  );
  const radii = base.entities.filter((e) => e.kind === 'circle' && !generatorOf(base, e.id) && !sized.has(e.id)).map((e) => e.id);
  return { points, radii };
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Relations and dimensions that would fully define the sketch, from how it is drawn now: nearly
 * horizontal or vertical lines get that relation, lines their length, circles and arcs their size,
 * and points that can still move their distances from the origin. Each is kept only if it takes
 * freedom away without a conflict.
 */
export async function suggestConstraints(
  solver: PlanegcsSolver,
  sketch: Sketch,
  values: ReadonlyMap<string, number>,
  idPrefix: string,
): Promise<{ constraints: SketchConstraint[]; degreesOfFreedom: number }> {
  let current = await solver.solve(sketch, values);
  if (current.status !== 'under-constrained') return { constraints: [], degreesOfFreedom: current.degreesOfFreedom };
  const drawn = current.sketch;
  const entities = new Map(drawn.entities.map((e) => [e.id, e]));
  const at = (id: string): Vec2 => {
    const p = entities.get(id);
    return p?.kind === 'point' ? [p.x, p.y] : [0, 0];
  };
  const own = (e: SketchEntity) => !generatorOf(drawn, e.id) && !('construction' in e && e.construction);
  const constrained = (test: (c: SketchConstraint) => boolean) => drawn.constraints.some(test);
  let n = 0;
  const id = () => `${idPrefix}${++n}`;
  const candidates: { constraint: SketchConstraint; value?: number }[] = [];

  for (const line of drawn.entities) {
    if (line.kind !== 'line' || !own(line)) continue;
    const [s, e] = [at(line.start), at(line.end)];
    const angle = (Math.atan2(e[1] - s[1], e[0] - s[0]) * 180) / Math.PI;
    const oriented = constrained((c) => ((c.kind === 'horizontal' || c.kind === 'vertical') && c.line === line.id) || ((c.kind === 'parallel' || c.kind === 'perpendicular' || c.kind === 'angle' || c.kind === 'collinear') && c.lines.includes(line.id)));
    if (!oriented && Math.min(Math.abs(angle), Math.abs(180 - Math.abs(angle))) < 3) candidates.push({ constraint: { id: id(), kind: 'horizontal', line: line.id } });
    else if (!oriented && Math.abs(Math.abs(angle) - 90) < 3) candidates.push({ constraint: { id: id(), kind: 'vertical', line: line.id } });
  }
  for (const line of drawn.entities) {
    if (line.kind !== 'line' || !own(line)) continue;
    const value = length([at(line.end)[0] - at(line.start)[0], at(line.end)[1] - at(line.start)[1]]);
    candidates.push({ constraint: { id: id(), kind: 'distance', points: [line.start, line.end], expression: `${round(value)} mm` }, value: round(value) });
  }
  for (const curve of drawn.entities) {
    if (!own(curve)) continue;
    if (curve.kind === 'circle') candidates.push({ constraint: { id: id(), kind: 'diameter', curve: curve.id, expression: `${round(curve.radius * 2)} mm` }, value: round(curve.radius * 2) });
    if (curve.kind === 'arc') {
      const r = round(length([at(curve.start)[0] - at(curve.center)[0], at(curve.start)[1] - at(curve.center)[1]]));
      candidates.push({ constraint: { id: id(), kind: 'radius', curve: curve.id, expression: `${r} mm` }, value: r });
    }
  }
  for (const point of drawn.entities) {
    if (point.kind !== 'point' || generatorOf(drawn, point.id)) continue;
    candidates.push(
      { constraint: { id: id(), kind: 'horizontal-distance', points: [sketchOriginId, point.id], expression: `${round(point.x)} mm` }, value: round(point.x) },
      { constraint: { id: id(), kind: 'vertical-distance', points: [sketchOriginId, point.id], expression: `${round(point.y)} mm` }, value: round(point.y) },
    );
  }

  const accepted: SketchConstraint[] = [];
  const acceptedValues = new Map(values);
  for (const { constraint, value } of candidates) {
    if (current.degreesOfFreedom === 0) break;
    const trial = new Map(acceptedValues);
    if (isDimension(constraint) && value !== undefined) trial.set(constraint.id, value);
    const next = await solver.solve({ ...drawn, constraints: [...drawn.constraints, ...accepted, constraint] }, trial);
    if (next.status === 'over-constrained' || next.status === 'failed' || next.degreesOfFreedom >= current.degreesOfFreedom) continue;
    accepted.push(constraint);
    if (value !== undefined) acceptedValues.set(constraint.id, value);
    current = next;
  }
  return { constraints: accepted, degreesOfFreedom: current.degreesOfFreedom };
}
