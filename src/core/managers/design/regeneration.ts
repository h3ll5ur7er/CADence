import {
  asDocumentId,
  type AxisRef,
  type ComponentDocument,
  type Dimension,
  fail,
  type Feature,
  isDimension,
  isSketch,
  isToolFeature,
  ok,
  originFrames,
  type PlaneFrame,
  type PlaneRef,
  type Result,
  type Sketch,
  sketchOriginId,
  type Vec3,
} from '@core/contracts';
import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { AxisInput, BodyState, ModelingEngine, ModelingRequest, ToolInput } from '@core/engines/modeling';
import type { ParameterEngine, ParameterError, Quantity, ValueKind } from '@core/engines/parameter';
import type { DragTarget, SketchEngine } from '@core/engines/sketch';
import { contentHash } from '@core/utilities/identity';
import type { ItemStatus, ParameterView, SketchView } from './design-manager';

export interface RegenerationEngines {
  readonly sketches: SketchEngine;
  readonly parameters: ParameterEngine;
  readonly modeling: ModelingEngine;
  /** Insert features read imported files: the document, its original, and a reader. */
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly interchange: InterchangeEngine;
}

/** Everything derived from a document by running its timeline. */
export interface Derived {
  readonly sketches: Map<string, SketchView>;
  readonly items: Map<string, ItemStatus>;
  readonly planes: Map<string, PlaneFrame>;
  readonly bodies: readonly BodyState[];
  readonly tools: Map<string, ToolInput>;
  readonly parameters: ParameterView[];
  readonly parameterError?: ParameterError;
}

const constraintLabels: Readonly<Record<string, string>> = {
  coincident: 'coincident',
  horizontal: 'horizontal',
  vertical: 'vertical',
  parallel: 'parallel',
  perpendicular: 'perpendicular',
  equal: 'equal',
  tangent: 'tangent',
  'point-on': 'point on curve',
  midpoint: 'midpoint',
  fix: 'fixed point',
  distance: 'distance',
  'horizontal-distance': 'horizontal distance',
  'vertical-distance': 'vertical distance',
  'point-line-distance': 'distance to line',
  radius: 'radius',
  diameter: 'diameter',
  angle: 'angle',
};

/** Omit that keeps a union's members apart. */
type WithoutKey<T> = T extends unknown ? Omit<T, 'key'> : never;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Runs a component's timeline: parameters, then each sketch and feature in order. */
export class Regeneration {
  private readonly sketches = new Map<string, SketchView>();
  private readonly items = new Map<string, ItemStatus>();
  private readonly planes = new Map<string, PlaneFrame>();
  private readonly tools = new Map<string, ToolInput>();
  private bodies: readonly BodyState[] = [];
  private scope: ReadonlyMap<string, Quantity> = new Map();

  constructor(
    private readonly engines: RegenerationEngines,
    private readonly drag?: DragTarget & { readonly sketch: string },
  ) {}

  async run(document: ComponentDocument): Promise<Derived> {
    const evaluated = this.engines.parameters.evaluateAll(document.parameters);
    if (evaluated.ok) this.scope = evaluated.value;
    const parameters = document.parameters.map((parameter): ParameterView => {
      const value = this.scope.get(parameter.name);
      return value ? { parameter, display: display(value) } : { parameter };
    });
    for (const item of document.timeline) {
      if (item.suppressed) {
        this.items.set(item.id, { state: 'suppressed' });
        continue;
      }
      const result = isSketch(item) ? await this.sketch(item) : await this.feature(item);
      this.items.set(item.id, result.ok ? { state: 'ok' } : { state: 'error', error: result.error.message });
    }
    return {
      sketches: this.sketches,
      items: this.items,
      planes: this.planes,
      bodies: this.bodies,
      tools: this.tools,
      parameters,
      ...(evaluated.ok ? {} : { parameterError: evaluated.error }),
    };
  }

  /** Evaluates an expression with the component's parameters. */
  value(expression: string, kind: ValueKind, what: string): Result<number> {
    const value = this.engines.parameters.evaluate(expression, kind, this.scope);
    return value.ok ? value : fail({ code: 'invalid-expression', message: `${what} "${expression}": ${value.error.message}` });
  }

  private async sketch(sketch: Sketch): Promise<Result<void>> {
    const frame = await this.frame(sketch.plane);
    const unsolved = (error: string, f: PlaneFrame = originFrames.XY) => {
      this.sketches.set(sketch.id, { sketch, frame: f, status: 'failed', degreesOfFreedom: 0, profiles: [], values: new Map(), error });
      return fail({ code: 'unsolvable', message: error });
    };
    if (!frame.ok) return unsolved(frame.error.message);
    const values = new Map<string, number>();
    for (const dimension of sketch.constraints.filter(isDimension)) {
      const value = this.dimension(dimension);
      if (!value.ok) return unsolved(value.error.message, frame.value);
      values.set(dimension.id, value.value);
    }
    const drag = this.drag?.sketch === sketch.id ? this.drag : undefined;
    const solution = await this.engines.sketches.solve(sketch, values, drag);
    if (solution.status === 'over-constrained') {
      const kinds = sketch.constraints.filter((c) => solution.conflicting.includes(c.id)).map((c) => constraintLabels[c.kind]);
      return unsolved(`This conflicts with existing constraints (${[...new Set(kinds)].join(', ')}). Remove one of them first.`, frame.value);
    }
    if (solution.status === 'failed') return unsolved('The sketch cannot satisfy these constraints. Check the dimension values.', frame.value);
    if (collapses(solution.sketch)) return unsolved('This would shrink a line, circle or arc to nothing.', frame.value);
    this.sketches.set(sketch.id, { ...solution, frame: frame.value, values });
    return ok(undefined);
  }

  private dimension(d: Dimension): Result<number> {
    const value = this.value(d.expression, d.kind === 'angle' ? 'angle' : 'length', constraintLabels[d.kind] ?? d.kind);
    if (value.ok && value.value < 0 && d.kind !== 'horizontal-distance' && d.kind !== 'vertical-distance') {
      return fail({ code: 'invalid-expression', message: `${constraintLabels[d.kind]} cannot be negative.` });
    }
    return value;
  }

  private async feature(feature: Feature): Promise<Result<void>> {
    if (feature.type === 'plane') {
      const base = await this.frame(feature.base);
      if (!base.ok) return base;
      const offset = this.value(feature.offset, 'length', 'Offset');
      if (!offset.ok) return offset;
      const normal = cross(base.value.u, base.value.v);
      this.planes.set(feature.id, { ...base.value, origin: add(base.value.origin, scale(normal, offset.value)) });
      return ok(undefined);
    }
    const request = await this.request(feature);
    if (!request.ok) return request;
    const outcome = await this.engines.modeling.apply(request.value);
    if (outcome.error) return fail({ code: 'feature-failed', message: outcome.error });
    this.bodies = outcome.bodies;
    if (outcome.toolKey && isToolFeature(feature)) {
      this.tools.set(feature.id, { feature: feature.id, toolKey: outcome.toolKey, operation: feature.operation });
    }
    return ok(undefined);
  }

  /** The kernel request for a feature, with expressions evaluated and references resolved. */
  private async request(feature: Exclude<Feature, { type: 'plane' }>): Promise<Result<ModelingRequest>> {
    const base = { feature: feature.id, bodies: this.bodies };
    const withKey = (body: WithoutKey<ModelingRequest>): Result<ModelingRequest> =>
      ok({ ...body, key: contentHash({ ...body, bodies: this.bodies.map((b) => b.key) }) } as ModelingRequest);
    switch (feature.type) {
      case 'insert': {
        const document = await this.engines.documents.load(asDocumentId(feature.document));
        const format = document?.kind === 'imported' ? document.format : undefined;
        if (!document || document.kind !== 'imported' || format === undefined || format === 'dxf' || format === 'svg') {
          return fail({ code: 'missing-input', message: 'Its imported 3D file was deleted or is not a 3D file.' });
        }
        const original = await this.engines.assets.fetch(document.assetId);
        if (!original) return fail({ code: 'missing-input', message: 'The original of its imported file is missing.' });
        const sources = await this.engines.interchange.readSolids(original.bytes, format, `import:${document.assetId}`);
        if (!sources.ok) return fail({ code: 'feature-failed', message: sources.error.message });
        return withKey({ ...base, type: 'insert', sources: sources.value });
      }
      case 'extrude':
      case 'revolve': {
        const view = this.sketches.get(feature.sketch);
        if (!view || view.error) return fail({ code: 'missing-input', message: 'Its sketch is missing, later in the timeline or does not solve.' });
        const profiles = view.profiles.filter((p) => feature.profiles.includes(p.id));
        if (profiles.length < feature.profiles.length || profiles.length === 0) {
          return fail({ code: 'missing-input', message: 'Some of its profiles no longer exist. Edit the feature and pick them again.' });
        }
        if (feature.type === 'extrude') {
          const distance = this.value(feature.distance, 'length', 'Distance');
          if (!distance.ok) return distance;
          return withKey({ ...base, type: 'extrude', frame: view.frame, profiles, distance: distance.value, direction: feature.direction, operation: feature.operation });
        }
        const angle = this.value(feature.angle, 'angle', 'Angle');
        if (!angle.ok) return angle;
        const axis = this.axis(feature.axis);
        if (!axis.ok) return axis;
        return withKey({ ...base, type: 'revolve', frame: view.frame, profiles, axis: axis.value, angle: angle.value, operation: feature.operation });
      }
      case 'fillet':
      case 'chamfer': {
        const size = this.value(feature.size, 'length', feature.type === 'fillet' ? 'Radius' : 'Distance');
        if (!size.ok) return size;
        return withKey({ ...base, type: feature.type, edges: feature.edges, size: size.value });
      }
      case 'shell': {
        const thickness = this.value(feature.thickness, 'length', 'Thickness');
        if (!thickness.ok) return thickness;
        return withKey({ ...base, type: 'shell', faces: feature.faces, thickness: thickness.value });
      }
      case 'linear-pattern':
      case 'circular-pattern':
      case 'mirror': {
        const tools = feature.features.map((id) => this.tools.get(id));
        if (tools.some((t) => !t) || tools.length === 0) {
          return fail({ code: 'missing-input', message: 'It repeats features that are missing, failed or come later in the timeline.' });
        }
        const inputs = tools as ToolInput[];
        if (feature.type === 'mirror') {
          const plane = await this.frame(feature.plane);
          if (!plane.ok) return plane;
          return withKey({ ...base, type: 'mirror', tools: inputs, plane: plane.value });
        }
        const count = this.value(feature.count, 'scalar', 'Count');
        if (!count.ok) return count;
        if (feature.type === 'linear-pattern') {
          const spacing = this.value(feature.spacing, 'length', 'Spacing');
          const direction = this.axis(feature.direction);
          if (!spacing.ok) return spacing;
          if (!direction.ok) return direction;
          return withKey({ ...base, type: 'linear-pattern', tools: inputs, direction: direction.value, count: count.value, spacing: spacing.value });
        }
        const angle = this.value(feature.angle, 'angle', 'Angle');
        const axis = this.axis(feature.axis);
        if (!angle.ok) return angle;
        if (!axis.ok) return axis;
        return withKey({ ...base, type: 'circular-pattern', tools: inputs, axis: axis.value, count: count.value, angle: angle.value });
      }
    }
  }

  private async frame(ref: PlaneRef): Promise<Result<PlaneFrame>> {
    if (typeof ref === 'string') return ok(originFrames[ref]);
    if ('plane' in ref) {
      const frame = this.planes.get(ref.plane);
      return frame ? ok(frame) : fail({ code: 'missing-input', message: 'Its construction plane is missing, failed or comes later in the timeline.' });
    }
    if (!this.bodies.some((b) => b.id === ref.face.body)) {
      return fail({ code: 'missing-input', message: 'The body of its face is missing at this point of the timeline.' });
    }
    return this.engines.modeling.planeOf(this.bodies, ref.face);
  }

  private axis(ref: AxisRef): Result<AxisInput> {
    if (ref.kind === 'origin') {
      const direction: Vec3 = ref.axis === 'X' ? [1, 0, 0] : ref.axis === 'Y' ? [0, 1, 0] : [0, 0, 1];
      return ok({ origin: [0, 0, 0], direction });
    }
    if (ref.kind === 'edge') return ok({ edge: ref.edge });
    const view = this.sketches.get(ref.sketch);
    const line = view?.sketch.entities.find((e) => e.id === ref.line);
    if (!view || line?.kind !== 'line') return fail({ code: 'missing-input', message: 'Its axis line is missing.' });
    const point = (id: string): Vec3 => {
      const p = id === sketchOriginId ? { x: 0, y: 0 } : view.sketch.entities.find((e) => e.id === id && e.kind === 'point');
      const [x, y] = p && 'x' in p ? [p.x, p.y] : [0, 0];
      return add(view.frame.origin, add(scale(view.frame.u, x), scale(view.frame.v, y)));
    };
    const start = point(line.start);
    const end = point(line.end);
    return ok({ origin: start, direction: add(end, scale(start, -1)) });
  }
}

/** Solvable but meaningless: a curve of (almost) zero size, e.g. a line both horizontal and vertical. */
function collapses(sketch: Sketch): boolean {
  const minimum = 1e-6;
  const points = new Map<string, readonly [number, number]>([[sketchOriginId, [0, 0]]]);
  for (const e of sketch.entities) if (e.kind === 'point') points.set(e.id, [e.x, e.y]);
  const gap = (a: string, b: string) => {
    const [p, q] = [points.get(a) ?? [0, 0], points.get(b) ?? [0, 0]];
    return Math.hypot(p[0] - q[0], p[1] - q[1]);
  };
  return sketch.entities.some(
    (e) =>
      (e.kind === 'line' && gap(e.start, e.end) < minimum) ||
      (e.kind === 'circle' && e.radius < minimum) ||
      (e.kind === 'arc' && (gap(e.center, e.start) < minimum || gap(e.start, e.end) < minimum)) ||
      (e.kind === 'ellipse' && (gap(e.center, e.major) < minimum || e.minorRadius < minimum)) ||
      (e.kind === 'spline' && e.points.some((p, i) => i > 0 && gap(e.points[i - 1] as string, p) < minimum)),
  );
}

function display(q: Quantity): string {
  const round = (v: number) => String(Math.round(v * 1000) / 1000);
  if (q.length === 1 && q.angle === 0) return `${round(q.value)} mm`;
  if (q.length === 0 && q.angle === 1) return `${round((q.value * 180) / Math.PI)}°`;
  if (q.length === 0 && q.angle === 0) return round(q.value);
  return `${round(q.value)} mm^${q.length}`;
}
