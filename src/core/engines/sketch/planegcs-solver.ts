import {
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
  /** Ids of the constraints that contradict each other. */
  readonly conflicting: readonly string[];
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

  constructor(private readonly sketch: Sketch, private readonly values: ReadonlyMap<string, number>) {
    this.entities = new Map(sketch.entities.map((e) => [e.id, e]));
    this.primitives.push({ id: sketchOriginId, type: 'point', x: 0, y: 0, fixed: true });
    // planegcs requires referenced primitives to be pushed first: points, then curves.
    for (const e of sketch.entities) if (e.kind === 'point') this.primitives.push({ id: e.id, type: 'point', x: e.x, y: e.y, fixed: false });
    for (const e of sketch.entities) if (e.kind !== 'point') this.pushCurve(e);
    for (const c of sketch.constraints) this.pushConstraint(c);
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
        return;
      case 'line':
        this.primitives.push({ id: e.id, type: 'line', p1_id: e.start, p2_id: e.end });
        return;
      case 'circle':
        this.primitives.push({ id: e.id, type: 'circle', c_id: e.center, radius: e.radius });
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
        add('coordinate_x', { p_id: c.point, x: c.x }, 'x');
        return add('coordinate_y', { p_id: c.point, y: c.y }, 'y');
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

/** Solves sketches with FreeCAD's planegcs (WebAssembly). One solver instance, reused. */
export class PlanegcsSolver {
  private wrapper: Promise<GcsWrapper> | undefined;

  constructor(private readonly wasmUrl?: string) {}

  async solve(sketch: Sketch, values: ReadonlyMap<string, number>, drag?: DragTarget): Promise<SolveOutcome> {
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
    const conflicting = [
      ...new Set([...gcs.get_gcs_conflicting_constraints(), ...gcs.get_gcs_redundant_constraints()].map(ownerOf)),
    ];
    // An ellipse's minor radius is a freedom of its own until a dimension sets it.
    const minorRadii = new Map(
      sketch.constraints.flatMap((c) => (c.kind === 'radius' && sketch.entities.find((e) => e.id === c.curve)?.kind === 'ellipse' ? [[c.curve, values.get(c.id)] as const] : [])),
    );
    const degreesOfFreedom = gcs.gcs.dof() + sketch.entities.filter((e) => e.kind === 'ellipse' && minorRadii.get(e.id) === undefined).length;
    if (conflicting.length > 0) {
      return { sketch, status: 'over-constrained', degreesOfFreedom, conflicting };
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
