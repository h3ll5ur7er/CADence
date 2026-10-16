import {
  generatorOf,
  type Sketch,
  type SketchConstraint,
  type SketchEntity,
  type SketchStatus,
  sketchOriginId,
} from '@core/contracts';
import { angleOf, normalizeAngle, sub, type Vec2 } from '@core/utilities/math';
import type { GcsWrapper } from '@salusoft89/planegcs';

/** A point to pull toward a target while solving (interactive dragging). */
export interface DragTarget {
  readonly point: string;
  readonly x: number;
  readonly y: number;
}

export interface SolveOutcome {
  readonly sketch: Sketch;
  readonly status: SketchStatus;
  readonly degreesOfFreedom: number;
  /** Ids of the constraints that contradict each other, or say the same twice. */
  readonly conflicting: readonly string[];
  /** Of those, the ones that only say what others already do (redundant, not contradictory). */
  readonly redundant?: readonly string[];
}

type Primitive = Record<string, unknown> & { id: string; type: string };

/** planegcs SolveStatus values (kept here so the solver module itself loads lazily). */
const solveStatus = { success: 0, converged: 1 } as const;

/** Solver ids of derived primitives carry the owning constraint id before '#'. */
const ownerOf = (solverId: string) => solverId.split('#')[0] as string;

/** Picks, among values equivalent for a solver, the one closest to the current configuration. */
function closest(current: number, candidates: readonly number[]): number {
  return candidates.reduce((best, c) => (Math.abs(c - current) < Math.abs(best - current) ? c : best));
}

class Translator {
  readonly primitives: Primitive[] = [];
  private readonly entities: ReadonlyMap<string, SketchEntity>;
  /** Coordinates of fixed points left to the arcs they lie on (see `redundantPins`). */
  private readonly unpinned: ReadonlyMap<string, ReadonlySet<'x' | 'y'>>;

  constructor(private readonly sketch: Sketch, private readonly values: ReadonlyMap<string, number>) {
    this.entities = new Map(sketch.entities.map((e) => [e.id, e]));
    this.unpinned = this.redundantPins();
    this.primitives.push({ id: sketchOriginId, type: 'point', x: 0, y: 0, fixed: true });
    // planegcs requires referenced primitives to be pushed first: points, then curves.
    // Points of projected geometry follow the body, not the solver.
    for (const e of sketch.entities) if (e.kind === 'point') this.primitives.push({ id: e.id, type: 'point', x: e.x, y: e.y, fixed: generatorOf(sketch, e.id) !== undefined });
    for (const e of sketch.entities) if (e.kind !== 'point') this.pushCurve(e);
    for (const c of sketch.constraints) this.pushConstraint(c);
  }

  /**
   * An arc whose centre and both ends are fixed is pinned once too often: its end must lie on the
   * circle through its start anyway. One coordinate of one end is left to the arc, the one that moves
   * most along it, at an end no other arc has taken a coordinate from yet if there is one.
   */
  private redundantPins(): Map<string, Set<'x' | 'y'>> {
    const fixed = new Set(this.sketch.constraints.flatMap((c) => (c.kind === 'fix' ? [c.point] : [])));
    const unpinned = new Map<string, Set<'x' | 'y'>>();
    for (const e of this.sketch.entities) {
      if (e.kind !== 'arc' || ![e.center, e.start, e.end].every((p) => fixed.has(p))) continue;
      const c = this.position(e.center);
      // Along the arc, x changes with the radius' y part and y with its x part: leave the one that moves less.
      const best = (p: string): 'x' | 'y' => {
        const r = sub(this.position(p), c);
        return Math.abs(r[0]) > Math.abs(r[1]) ? 'x' : 'y';
      };
      const other = (axis: 'x' | 'y') => (axis === 'x' ? 'y' : 'x');
      const choices: [string, 'x' | 'y'][] = [
        ...[e.end, e.start].filter((p) => !unpinned.has(p)).map((p): [string, 'x' | 'y'] => [p, best(p)]),
        ...[e.end, e.start].flatMap((p): [string, 'x' | 'y'][] => [[p, best(p)], [p, other(best(p))]]),
      ];
      const choice = choices.find(([p, axis]) => !unpinned.get(p)?.has(axis));
      if (!choice) continue;
      unpinned.set(choice[0], new Set([...(unpinned.get(choice[0]) ?? []), choice[1]]));
    }
    return unpinned;
  }

  private position(id: string): Vec2 {
    if (id === sketchOriginId) return [0, 0];
    const e = this.entities.get(id);
    if (e?.kind !== 'point') throw new Error(`Sketch point ${id} does not exist`);
    return [e.x, e.y];
  }

  private kindOf(id: string): SketchEntity['kind'] {
    const e = this.entities.get(id);
    if (!e) throw new Error(`Sketch entity ${id} does not exist`);
    return e.kind;
  }

  private centerOf(id: string): string {
    const e = this.entities.get(id);
    if (e?.kind !== 'circle' && e?.kind !== 'arc' && e?.kind !== 'ellipse') throw new Error(`${id} has no centre`);
    return e.center;
  }

  /** The end point two lines or arcs share, if any. */
  private sharedEnd(a: string, b: string): string | undefined {
    const ends = (id: string): string[] => {
      const e = this.entities.get(id);
      return e?.kind === 'line' || e?.kind === 'arc' ? [e.start, e.end] : [];
    };
    const other = ends(b);
    return ends(a).find((p) => other.includes(p));
  }

  /** Direction of travel of a line or arc (counter-clockwise) at one of its points. */
  private tangentAt(id: string, point: string): Vec2 {
    const e = this.entities.get(id);
    if (e?.kind === 'line') return this.lineDirection(id);
    if (e?.kind !== 'arc') return [1, 0];
    const r = sub(this.position(point), this.position(e.center));
    return [-r[1], r[0]];
  }

  private lineDirection(id: string): Vec2 {
    const e = this.entities.get(id);
    if (e?.kind !== 'line') throw new Error(`${id} is not a line`);
    return sub(this.position(e.end), this.position(e.start));
  }

  private value(id: string): number {
    const value = this.values.get(id);
    if (value === undefined) throw new Error(`No value for dimension ${id}`);
    return value;
  }

  private pushCurve(e: Exclude<SketchEntity, { kind: 'point' }>): void {
    switch (e.kind) {
      // Ellipses and splines are shaped by their points (and an ellipse's minor radius, set by its
      // dimension after solving); the solver needs no curve for them.
      case 'ellipse':
      case 'spline':
      case 'projection':
      case 'drawing':
      case 'text':
        return;
      case 'line':
        this.primitives.push({ id: e.id, type: 'line', p1_id: e.start, p2_id: e.end });
        return;
      case 'circle':
        this.primitives.push({ id: e.id, type: 'circle', c_id: e.center, radius: e.radius });
        // Generated circles keep their size as well as their centre.
        if (generatorOf(this.sketch, e.id)) this.primitives.push({ id: `${e.id}#r`, type: 'circle_radius', c_id: e.id, radius: e.radius });
        return;
      case 'arc': {
        const center = this.position(e.center);
        const start = sub(this.position(e.start), center);
        const end = sub(this.position(e.end), center);
        const startAngle = angleOf(start);
        let endAngle = angleOf(end);
        while (endAngle <= startAngle) endAngle += 2 * Math.PI;
        this.primitives.push({
          id: e.id,
          type: 'arc',
          c_id: e.center,
          radius: Math.hypot(start[0], start[1]),
          start_angle: startAngle,
          end_angle: endAngle,
          start_id: e.start,
          end_id: e.end,
        });
        this.primitives.push({ id: `${e.id}#rules`, type: 'arc_rules', a_id: e.id });
        return;
      }
    }
  }

  private pushConstraint(c: SketchConstraint): void {
    const add = (type: string, fields: Record<string, unknown>, suffix = ''): void => {
      this.primitives.push({ id: suffix ? `${c.id}#${suffix}` : c.id, type, ...fields });
    };
    switch (c.kind) {
      case 'coincident':
        return add('p2p_coincident', { p1_id: c.points[0], p2_id: c.points[1] });
      case 'horizontal':
        return add('horizontal_l', { l_id: c.line });
      case 'vertical':
        return add('vertical_l', { l_id: c.line });
      case 'parallel':
        return add('parallel', { l1_id: c.lines[0], l2_id: c.lines[1] });
      case 'perpendicular':
        return add('perpendicular_ll', { l1_id: c.lines[0], l2_id: c.lines[1] });
      case 'equal':
        return this.pushEqual(c.curves, add);
      case 'tangent':
        return this.pushTangent(c.curves, add);
      case 'point-on': {
        const kind = this.kindOf(c.curve);
        if (kind === 'ellipse' || kind === 'spline') throw new Error(`Points cannot be put on a ${kind} yet`);
        if (kind === 'line') return add('point_on_line_pl', { p_id: c.point, l_id: c.curve });
        if (kind === 'circle') return add('point_on_circle', { p_id: c.point, c_id: c.curve });
        return add('point_on_arc', { p_id: c.point, a_id: c.curve });
      }
      case 'horizontal-points':
        return add('horizontal_pp', { p1_id: c.points[0], p2_id: c.points[1] });
      case 'vertical-points':
        return add('vertical_pp', { p1_id: c.points[0], p2_id: c.points[1] });
      case 'symmetric':
        return add('p2p_symmetric_ppl', { p1_id: c.points[0], p2_id: c.points[1], l_id: c.line });
      case 'concentric':
        return add('p2p_coincident', { p1_id: this.centerOf(c.curves[0]), p2_id: this.centerOf(c.curves[1]) });
      case 'collinear': {
        const second = this.entities.get(c.lines[1]);
        if (second?.kind !== 'line') throw new Error(`${c.lines[1]} is not a line`);
        add('parallel', { l1_id: c.lines[0], l2_id: c.lines[1] }, 'parallel');
        return add('point_on_line_pl', { p_id: second.start, l_id: c.lines[0] }, 'on');
      }
      case 'midpoint': {
        const line = this.entities.get(c.line);
        if (line?.kind !== 'line') throw new Error(`${c.line} is not a line`);
        return add('p2p_symmetric_ppp', { p1_id: line.start, p2_id: line.end, p_id: c.point });
      }
      case 'fix':
        if (!this.unpinned.get(c.point)?.has('x')) add('coordinate_x', { p_id: c.point, x: c.x }, 'x');
        if (!this.unpinned.get(c.point)?.has('y')) add('coordinate_y', { p_id: c.point, y: c.y }, 'y');
        return;
      case 'distance':
        return add('p2p_distance', { p1_id: c.points[0], p2_id: c.points[1], distance: this.value(c.id) });
      case 'horizontal-distance':
      case 'vertical-distance': {
        const axis = c.kind === 'horizontal-distance' ? 0 : 1;
        const prop = axis === 0 ? 'x' : 'y';
        const current = this.position(c.points[1])[axis] - this.position(c.points[0])[axis];
        const value = this.value(c.id);
        return add('difference', {
          param1: { o_id: c.points[0], prop },
          param2: { o_id: c.points[1], prop },
          difference: closest(current, [value, -value]),
        });
      }
      case 'point-line-distance':
        return add('p2l_distance', { p_id: c.point, l_id: c.line, distance: this.value(c.id) });
      case 'radius':
        if (this.kindOf(c.curve) === 'ellipse') return;
        return this.kindOf(c.curve) === 'circle'
          ? add('circle_radius', { c_id: c.curve, radius: this.value(c.id) })
          : add('arc_radius', { a_id: c.curve, radius: this.value(c.id) });
      case 'diameter':
        return this.kindOf(c.curve) === 'circle'
          ? add('circle_diameter', { c_id: c.curve, diameter: this.value(c.id) })
          : add('arc_diameter', { a_id: c.curve, diameter: this.value(c.id) });
      case 'angle': {
        const current = angleOf(this.lineDirection(c.lines[1])) - angleOf(this.lineDirection(c.lines[0]));
        const signed = normalizeAngle(current + Math.PI) - Math.PI;
        const v = this.value(c.id);
        return add('l2l_angle_ll', {
          l1_id: c.lines[0],
          l2_id: c.lines[1],
          angle: closest(signed, [v, -v, Math.PI - v, v - Math.PI]),
        });
      }
    }
  }

  private pushEqual(
    [a, b]: readonly [string, string],
    add: (type: string, fields: Record<string, unknown>) => void,
  ): void {
    const ka = this.kindOf(a);
    const kb = this.kindOf(b);
    if (ka === 'line' && kb === 'line') return add('equal_length', { l1_id: a, l2_id: b });
    if (ka === 'circle' && kb === 'circle') return add('equal_radius_cc', { c1_id: a, c2_id: b });
    if (ka === 'arc' && kb === 'arc') return add('equal_radius_aa', { a1_id: a, a2_id: b });
    if (ka === 'circle' && kb === 'arc') return add('equal_radius_ca', { c1_id: a, a2_id: b });
    if (ka === 'arc' && kb === 'circle') return add('equal_radius_ca', { c1_id: b, a2_id: a });
    throw new Error(`Cannot make ${ka} and ${kb} equal`);
  }

  private pushTangent(
    [a, b]: readonly [string, string],
    add: (type: string, fields: Record<string, unknown>) => void,
  ): void {
    // Curves that share an end point touch there: tangency at the point (as FreeCAD does), since the
    // plain tangency and the shared point together would count as redundant.
    const shared = this.sharedEnd(a, b);
    if (shared) {
      const [ta, tb] = [this.tangentAt(a, shared), this.tangentAt(b, shared)];
      const current = Math.atan2(ta[0] * tb[1] - ta[1] * tb[0], ta[0] * tb[0] + ta[1] * tb[1]);
      return add('angle_via_point', { crv1_id: a, crv2_id: b, p_id: shared, angle: closest(current, [0, Math.PI, -Math.PI]) });
    }
    const [first, second] = this.kindOf(a) === 'line' || this.kindOf(b) !== 'line' ? [a, b] : [b, a];
    const k1 = this.kindOf(first);
    const k2 = this.kindOf(second);
    if (k1 === 'line' && k2 === 'circle') return add('tangent_lc', { l_id: first, c_id: second });
    if (k1 === 'line' && k2 === 'arc') return add('tangent_la', { l_id: first, a_id: second });
    if (k1 === 'circle' && k2 === 'circle') return add('tangent_cc', { c1_id: first, c2_id: second });
    if (k1 === 'arc' && k2 === 'arc') return add('tangent_aa', { a1_id: first, a2_id: second });
    if (k1 === 'circle' && k2 === 'arc') return add('tangent_ca', { c_id: first, a_id: second });
    if (k1 === 'arc' && k2 === 'circle') return add('tangent_ca', { c_id: second, a_id: first });
    throw new Error(`Cannot make ${k1} and ${k2} tangent`);
  }
}

/** Ids of sketch entities that a value refers to, anywhere inside it. */
function references(value: unknown, entities: ReadonlySet<string>, found: string[] = []): string[] {
  if (typeof value === 'string') {
    if (entities.has(value)) found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) references(item, entities, found);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) references(item, entities, found);
  }
  return found;
}

/**
 * The sketch as groups that do not depend on each other: entities joined by what they are made of
 * by constraints between them and by what generates them. The origin is fixed, so it joins nothing.
 */
export function independentParts(sketch: Sketch): Sketch[] {
  const ids = new Set(sketch.entities.map((e) => e.id));
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const join = (group: readonly string[]) => {
    const [first, ...rest] = group.filter((id) => id !== sketchOriginId);
    if (first !== undefined) for (const id of rest) parent.set(find(id), find(first));
  };
  // Generated geometry (projections, drawings, equations) goes with what generates it: `owner:part` ids.
  for (const e of sketch.entities) join([e.id, ...references({ ...e, id: undefined }, ids), ...(generatorOf(sketch, e.id) ? [e.id.slice(0, e.id.lastIndexOf(':'))] : [])]);
  const constrained = sketch.constraints.map((c) => ({ c, refs: references({ ...c, id: undefined }, ids).filter((id) => id !== sketchOriginId) }));
  for (const { refs } of constrained) join(refs);
  const groups = new Map<string, { entities: SketchEntity[]; constraints: SketchConstraint[] }>();
  const group = (id: string) => {
    const root = find(id);
    let g = groups.get(root);
    if (!g) groups.set(root, (g = { entities: [], constraints: [] }));
    return g;
  };
  for (const e of sketch.entities) group(e.id).entities.push(e);
  // A constraint on nothing but the origin goes with the first group, where it fails or does nothing as before.
  for (const { c, refs } of constrained) (refs[0] !== undefined ? group(refs[0]) : (groups.values().next().value ?? group(sketchOriginId))).constraints.push(c);
  return [...groups.values()].map((g) => ({ ...sketch, entities: g.entities, constraints: g.constraints }));
}

const statusRank: Readonly<Record<SketchStatus, number>> = { 'fully-constrained': 0, 'under-constrained': 1, failed: 2, 'over-constrained': 3 };

/** Solves sketches with FreeCAD's planegcs (WebAssembly). One solver instance, reused. */
export class PlanegcsSolver {
  private wrapper: Promise<GcsWrapper> | undefined;

  constructor(private readonly wasmUrl?: string) {}

  /**
   * Solves each independent part of the sketch on its own: the solver's work grows with the cube of
   * a system's size, so hundreds of separate holes would otherwise take minutes and run out of memory (CAD-94).
   */
  async solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget): Promise<SolveOutcome> {
    const parts = independentParts(sketch);
    if (parts.length <= 1) return this.solvePart(sketch, values, drag);
    const outcomes: SolveOutcome[] = [];
    for (const part of parts) outcomes.push(await this.solvePart(part, values, drag && part.entities.some((e) => e.id === drag.point) ? drag : undefined));
    const solved = new Map(outcomes.flatMap((o) => o.sketch.entities.map((e) => [e.id, e] as const)));
    const status = outcomes.reduce((worst, o) => (statusRank[o.status] > statusRank[worst] ? o.status : worst), 'fully-constrained' as SketchStatus);
    const failed = status === 'failed' || status === 'over-constrained';
    const degreesOfFreedom = outcomes.reduce((n, o) => n + o.degreesOfFreedom, 0);
    return {
      // A sketch that fails keeps its positions, as when it is solved whole.
      sketch: failed ? sketch : { ...sketch, entities: sketch.entities.map((e) => solved.get(e.id) ?? e) },
      status: !failed && degreesOfFreedom === 0 ? 'fully-constrained' : status,
      degreesOfFreedom,
      conflicting: outcomes.flatMap((o) => o.conflicting),
      redundant: outcomes.flatMap((o) => o.redundant ?? []),
    };
  }

  private async solvePart(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget): Promise<SolveOutcome> {
    const gcs = await this.instance();
    gcs.clear_data();
    const { primitives } = new Translator(sketch, values);
    if (drag) {
      primitives.push(
        { id: 'drag#x', type: 'coordinate_x', p_id: drag.point, x: drag.x, temporary: true },
        { id: 'drag#y', type: 'coordinate_y', p_id: drag.point, y: drag.y, temporary: true },
      );
    }
    gcs.push_primitives_and_params(primitives as never);
    const result: number = gcs.solve();
    const contradicting = new Set(gcs.get_gcs_conflicting_constraints().map(ownerOf));
    const redundant = [...new Set(gcs.get_gcs_redundant_constraints().map(ownerOf))].filter((id) => !contradicting.has(id));
    const conflicting = [...contradicting, ...redundant];
    // An ellipse's minor radius is a freedom of its own until a dimension sets it.
    const minorRadii = new Map(
      sketch.constraints.flatMap((c) => (c.kind === 'radius' && sketch.entities.find((e) => e.id === c.curve)?.kind === 'ellipse' ? [[c.curve, values.get(c.id)] as const] : [])),
    );
    const degreesOfFreedom = gcs.gcs.dof() + sketch.entities.filter((e) => e.kind === 'ellipse' && minorRadii.get(e.id) === undefined).length;
    if (conflicting.length > 0) {
      return { sketch, status: 'over-constrained', degreesOfFreedom, conflicting, redundant: contradicting.size ? [] : redundant };
    }
    if (result !== solveStatus.success && result !== solveStatus.converged) {
      return { sketch, status: 'failed', degreesOfFreedom, conflicting };
    }
    gcs.apply_solution();
    const solved = new Map(gcs.sketch_index.get_primitives().map((p) => [p.id, p as unknown as Primitive]));
    const entities = sketch.entities.map((e): SketchEntity => {
      const p = solved.get(e.id);
      if (e.kind === 'point' && p) return { ...e, x: p['x'] as number, y: p['y'] as number };
      if (e.kind === 'circle' && p) return { ...e, radius: p['radius'] as number };
      if (e.kind === 'ellipse') return { ...e, minorRadius: minorRadii.get(e.id) ?? e.minorRadius };
      return e;
    });
    return {
      sketch: { ...sketch, entities },
      status: degreesOfFreedom > 0 ? 'under-constrained' : 'fully-constrained',
      degreesOfFreedom,
      conflicting,
    };
  }

  /** Loads planegcs on first use, so it stays out of the app's start-up bundle. */
  private instance(): Promise<GcsWrapper> {
    this.wrapper ??= import('@salusoft89/planegcs').then(async ({ make_gcs_wrapper, DebugMode }) => {
      const gcs = await make_gcs_wrapper(this.wasmUrl);
      gcs.debug_mode = DebugMode.NoDebug;
      return gcs;
    });
    return this.wrapper;
  }
}
