import {
  asDocumentId,
  type AxisRef,
  bearings,
  bevelMesh,
  type BodyOperation,
  type ComponentDocument,
  type Dimension,
  fail,
  type Feature,
  fitAllowance,
  type CornerRelief,
  type FlangeMarker,
  generatorOf,
  type HelixPath,
  isDimension,
  isFontFormat,
  type ImportedDocument,
  isModelFormat,
  isSketch,
  isToolFeature,
  type LengthUnit,
  lengthUnitSize,
  metric,
  metricThreads,
  ok,
  originFrames,
  type Parameter,
  type PartSpec,
  type PlaneFrame,
  type PlaneRef,
  type Profile,
  type Result,
  type Sketch,
  type SketchDrawing,
  type SketchEntity,
  type SketchEquation,
  type SketchInsertion,
  insertedId,
  isCurve,
  sketchOriginId,
  type SketchProjection,
  type SpringSize,
  type ThreadMarker,
  type TraceSettings,
  type Vec2,
  type Vec3,
  wormMesh,
} from '@core/contracts';
import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { DrawingEntities, InterchangeEngine } from '@core/engines/interchange';
import type { AxisInput, BodyState, HelixPiece, ModelingEngine, ModelingRequest, PathPiece, Placement, ToolInput, PartSolid } from '@core/engines/modeling';
import type { ParameterEngine, ParameterError, Quantity, ValueKind } from '@core/engines/parameter';
import { type DragTarget, type FontFiles, measureDimension, placesAlong, type SketchEngine, type SketchPath, sketchPath } from '@core/engines/sketch';
import { contentHash } from '@core/utilities/identity';
import { references } from './commands';
import type { ItemStatus, ParameterView, SketchView } from './design-manager';

/** Imported drawings read for sketches, by original and id prefix (originals never change). */
const drawingCache = new Map<string, Promise<Result<DrawingEntities>>>();

/** Whether solving moved a handle point of a drawing kept as one piece, or the point a block is placed at. */
function handlesMoved(before: Sketch, after: Sketch): boolean {
  const at = (sketch: Sketch, id: string) => sketch.entities.find((e) => e.id === id);
  return before.entities.some((e) => {
    if (e.kind !== 'drawing' && e.kind !== 'block') return false;
    return (e.kind === 'drawing' ? [e.origin, e.handle] : [e.origin]).some((id) => {
      const [p, q] = [at(before, id), at(after, id)];
      return p?.kind === 'point' && q?.kind === 'point' && Math.hypot(p.x - q.x, p.y - q.y) > 1e-9;
    });
  });
}

/** What a component is regenerated with, beyond its own document. */
export interface RegenerationContext {
  readonly projectParameters?: readonly Parameter[];
  /** A configuration to build instead of the document's own (`''`: the parameters' own values). */
  readonly configuration?: string;
}

/** A sheet metal part as regenerated: the base flange's sketch plane and profiles, and the rules. */
export interface SheetView {
  readonly frame: PlaneFrame;
  readonly profiles: readonly Profile[];
  readonly rules: {
    readonly thickness: number;
    readonly bendRadius: number;
    readonly kFactor: number;
    readonly relief?: { readonly shape: CornerRelief; readonly size: number };
  };
}

export interface RegenerationEngines {
  readonly sketches: SketchEngine;
  readonly parameters: ParameterEngine;
  readonly modeling: ModelingEngine;
  /** Insert features read imported files: the document, its original, and a reader. */
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly interchange: InterchangeEngine;
}

/**
 * A circuit board's parts: the project's imported STEP files named like the 3D models its parts
 * refer to (CAD-170), and a key for its solids that changes when they do.
 */
async function boardParts(
  access: { readonly documents: DocumentAccess; readonly assets: AssetAccess; readonly interchange: InterchangeEngine },
  document: ImportedDocument,
  bytes: Uint8Array,
): Promise<{ parts?: ReadonlyMap<string, Uint8Array>; key: string }> {
  if (document.format !== 'kicad_pcb') return { key: document.assetId };
  // A copy: the geometry worker takes the bytes it is sent.
  const wanted = new Set(await access.interchange.partFiles(bytes.slice(), document.format));
  const parts = new Map<string, Uint8Array>();
  const used: string[] = [];
  for (const summary of await access.documents.enumerate(document.projectId)) {
    const name = summary.name.toLowerCase();
    if (summary.format !== 'step' || !wanted.has(name) || parts.has(name)) continue;
    const step = await access.documents.load(summary.id);
    const asset = step?.kind === 'imported' ? await access.assets.fetch(step.assetId) : undefined;
    if (!asset || step?.kind !== 'imported') continue;
    parts.set(name, asset.bytes);
    used.push(step.assetId);
  }
  return { parts, key: [document.assetId, ...used.sort()].join('+') };
}

/** Everything derived from a document by running its timeline. */
export interface Derived {
  readonly sketches: Map<string, SketchView>;
  readonly items: Map<string, ItemStatus>;
  readonly planes: Map<string, PlaneFrame>;
  readonly bodies: readonly BodyState[];
  readonly tools: Map<string, ToolInput>;
  readonly threads: readonly ThreadMarker[];
  /** The springs made as bodies, by body (CAD-161): their sizes, for their rates. */
  readonly springs: ReadonlyMap<string, SpringSize>;
  /** Helix features, by feature (CAD-161): paths for sweeps, shown as curves. */
  readonly helices: ReadonlyMap<string, HelixPath>;
  /** The component's sheet (its base flange) and edge flanges, for the flat pattern. */
  readonly sheet?: SheetView;
  readonly flanges: readonly FlangeMarker[];
  readonly parameters: ParameterView[];
  readonly parameterError?: ParameterError;
}

/** The files of a project's imported fonts, for sketch texts (keyed by original, so a replaced font is read again). */
export function importedFonts(documents: Pick<DocumentAccess, 'load'>, assets: Pick<AssetAccess, 'fetch'>): FontFiles {
  return async (documentId) => {
    const document = await documents.load(asDocumentId(documentId));
    if (document?.kind !== 'imported' || !isFontFormat(document.format)) return undefined;
    const original = await assets.fetch(document.assetId);
    return original ? { key: document.assetId, bytes: original.bytes } : undefined;
  };
}

/** Where parts and holes go: the sketch's points by id, the sketch origin included (CAD-108). */
function placementPoints(sketch: Sketch, ids: readonly string[]): ({ id: string; at: Vec2 } | undefined)[] {
  return ids.map((id) => {
    if (id === sketchOriginId) return { id, at: [0, 0] };
    const p = sketch.entities.find((e) => e.id === id);
    return p?.kind === 'point' ? { id, at: [p.x, p.y] } : undefined;
  });
}

const missingPoints = (sketch: Sketch, ids: readonly string[]) => ids.filter((id, i) => !placementPoints(sketch, ids)[i]).join(', ');

/**
 * Why a sketch is over-constrained, naming what is involved (CAD-108): the kinds of constraints, or
 * the curves whose own rules take part (an arc's ends on its circle). Redundant constraints say the
 * same as others; contradicting ones cannot all hold.
 */
function conflictMessage(sketch: Sketch, ids: readonly string[], redundant: boolean): string {
  const constraints = sketch.constraints.filter((c) => ids.includes(c.id));
  const curves = sketch.entities.filter((e) => ids.includes(e.id) && !constraints.some((c) => c.id === e.id)).map((e) => `the ${e.kind} ${e.id}`);
  const involved = [...new Set([...constraints.map((c) => constraintLabels[c.kind] ?? c.kind), ...curves])].join(', ') || 'the sketch’s own rules';
  return redundant
    ? `This is already set by existing constraints (${involved}): it is redundant, not contradictory. Remove one of them first.`
    : `This conflicts with existing constraints (${involved}). Remove one of them first.`;
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

/** A named reference dimension as a parameter: what it measured last (ADR-54). */
interface NamedReference {
  readonly id: string;
  readonly name: string;
  readonly expression: string;
  readonly sketch: string;
  readonly sketchName: string;
  readonly dimension: string;
  /** The sketch's place in the timeline. */
  readonly index: number;
  readonly angle: boolean;
}

/** A value in millimetres or radians as an expression. */
const quantityText = (value: number, angle: boolean) => `${value.toFixed(9)} ${angle ? 'rad' : 'mm'}`;

/**
 * The document's named reference dimensions, at first with what they measured when last solved (the
 * stored positions). Names taken by parameters, or by an earlier reference, are left out.
 */
function namedReferences(document: ComponentDocument, taken: ReadonlySet<string>): NamedReference[] {
  const names = new Set(taken);
  const found: NamedReference[] = [];
  for (const [index, item] of document.timeline.entries()) {
    if (!isSketch(item)) continue;
    for (const d of item.constraints) {
      if (!isDimension(d) || !d.reference || !d.name || names.has(d.name)) continue;
      names.add(d.name);
      const angle = d.kind === 'angle';
      found.push({ id: `${item.id}/${d.id}`, name: d.name, expression: quantityText(measureDimension(item, d) ?? 0, angle), sketch: item.id, sketchName: item.name, dimension: d.id, index, angle });
    }
  }
  return found;
}

/** Omit that keeps a union's members apart. */
type WithoutKey<T> = T extends unknown ? Omit<T, 'key'> : never;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / (length(a) || 1));

/** Part sizes that are plain numbers, not lengths: counts and the profile shift coefficient. */
const scalars = new Set(['teeth', 'mateTeeth', 'starts', 'turns', 'shift']);

/** Runs a component's timeline: parameters, then each sketch and feature in order. */
export class Regeneration {
  private readonly sketches = new Map<string, SketchView>();
  private readonly items = new Map<string, ItemStatus>();
  private readonly planes = new Map<string, PlaneFrame>();
  private readonly tools = new Map<string, ToolInput>();
  private readonly threads: ThreadMarker[] = [];
  private readonly springs = new Map<string, SpringSize>();
  private readonly helices = new Map<string, HelixPath>();
  private readonly flanges: FlangeMarker[] = [];
  private sheet: SheetView | undefined;
  private bodies: readonly BodyState[] = [];
  /** The timeline being run, to name what made a missing body (CAD-142). */
  private timeline: ComponentDocument['timeline'] = [];
  /** The layer left over counterbored holes for printing: the printer's layer height. */
  private layer = 0.2;
  /** What the printer needs added to holes (and taken off pegs) for parts to fit as designed. */
  private compensation = 0;
  private scope: ReadonlyMap<string, Quantity> = new Map();
  /** The parameters in effect (the project's and the component's, configured). */
  private parameterList: readonly Parameter[] = [];
  /** Named reference dimensions, as parameters that hold what they measure (ADR-54). */
  private measures: NamedReference[] = [];

  constructor(
    private readonly engines: RegenerationEngines,
    private readonly drag?: DragTarget & { readonly sketch: string },
  ) {}

  /** Runs the timeline with the project's parameters (the component's own of the same name win). */
  async run(document: ComponentDocument, context: RegenerationContext = {}): Promise<Derived> {
    this.timeline = document.timeline;
    if (document.process?.kind === 'print') {
      this.layer = document.process.layerHeight;
      this.compensation = document.process.holeCompensation ?? 0;
    }
    // A configuration's values replace the parameters' expressions, by name.
    const chosen = context.configuration ?? document.configuration;
    const values = document.configurations?.find((c) => c.id === chosen)?.values ?? {};
    const configured = (p: Parameter): Parameter => (p.name in values ? { ...p, expression: values[p.name] as string } : p);
    const own = new Set(document.parameters.map((p) => p.name));
    const shared = (context.projectParameters ?? []).filter((p) => !own.has(p.name));
    this.parameterList = [...shared, ...document.parameters].map(configured);
    this.measures = namedReferences(document, new Set([...own, ...shared.map((p) => p.name)]));
    const evaluated = this.evaluateParameters();
    const marker = document.timeline.length - document.rollbackIndex;
    for (const [index, item] of document.timeline.entries()) {
      if (index >= marker) {
        this.items.set(item.id, { state: 'rolled-back' });
        continue;
      }
      if (item.suppressed) {
        this.items.set(item.id, { state: 'suppressed' });
        continue;
      }
      const result = isSketch(item) ? await this.sketch(item, index) : await this.feature(item);
      this.items.set(item.id, result.ok ? { state: 'ok' } : { state: 'error', error: result.error.message });
    }
    const view = (parameter: Parameter, project: boolean): ParameterView => {
      const value = this.scope.get(parameter.name);
      return { parameter, ...(value ? { display: display(value, document.units) } : {}), ...(project ? { project } : {}) };
    };
    const measuredViews = this.measures.map((r): ParameterView => {
      const value = this.scope.get(r.name);
      return { parameter: { id: r.id, name: r.name, expression: r.expression }, ...(value ? { display: display(value, document.units) } : {}), measured: r.sketchName };
    });
    const parameters = [...shared.map((p) => view(p, true)), ...document.parameters.map((p) => view(p, false)), ...measuredViews];
    return {
      sketches: this.sketches,
      items: this.items,
      planes: this.planes,
      bodies: this.bodies,
      tools: this.tools,
      threads: this.threads,
      springs: this.springs,
      helices: this.helices,
      ...(this.sheet ? { sheet: this.sheet } : {}),
      flanges: this.flanges,
      parameters,
      ...(evaluated.ok ? {} : { parameterError: evaluated.error }),
    };
  }

  /** Evaluates the parameters with the values the named reference dimensions measure so far. */
  private evaluateParameters(): Result<Map<string, Quantity>, ParameterError> {
    const evaluated = this.engines.parameters.evaluateAll([...this.parameterList, ...this.measures]);
    if (evaluated.ok) this.scope = evaluated.value;
    return evaluated;
  }

  /**
   * The first of `names` an expression uses, also through the parameters it uses: a dimension that
   * would read what its own sketch (or a later one) measures cannot drive it.
   */
  private usesAny(expression: string, names: ReadonlySet<string>): string | undefined {
    const expressions = new Map<string, string>([...this.parameterList, ...this.measures].map((p) => [p.name, p.expression]));
    const seen = new Set<string>();
    const stack = this.engines.parameters.namesIn(expression);
    while (stack.length) {
      const name = stack.pop() as string;
      if (seen.has(name)) continue;
      seen.add(name);
      if (names.has(name)) return name;
      const next = expressions.get(name);
      if (next !== undefined) stack.push(...this.engines.parameters.namesIn(next));
    }
    return undefined;
  }

  /** After a sketch solved: the values its named references measure, for everything after it. */
  private measuredBy(sketch: Sketch, measured: ReadonlyMap<string, number>): void {
    let changed = false;
    this.measures = this.measures.map((r) => {
      const value = r.sketch === sketch.id ? measured.get(r.dimension) : undefined;
      if (value === undefined || r.expression === quantityText(value, r.angle)) return r;
      changed = true;
      return { ...r, expression: quantityText(value, r.angle) };
    });
    if (changed) this.evaluateParameters();
  }

  /** Evaluates an expression with the component's parameters. */
  value(expression: string, kind: ValueKind, what: string): Result<number> {
    const value = this.engines.parameters.evaluate(expression, kind, this.scope);
    return value.ok ? value : fail({ code: 'invalid-expression', message: `${what} "${expression}": ${value.error.message}` });
  }

  private async sketch(stored: Sketch, index = 0): Promise<Result<void>> {
    const frame = await this.frame(stored.plane);
    const unsolved = (error: string, f: PlaneFrame = originFrames.XY, conflicting?: readonly string[]) => {
      this.sketches.set(stored.id, { sketch: stored, frame: f, status: 'failed', degreesOfFreedom: 0, profiles: [], texts: new Map(), values: new Map(), error, ...(conflicting ? { conflicting } : {}) });
      return fail({ code: 'unsolvable', message: error });
    };
    if (!frame.ok) return unsolved(frame.error.message);
    const projected = await this.generated(stored, frame.value);
    if (!projected.ok) return unsolved(projected.error.message, frame.value);
    let sketch = projected.value;
    const values = new Map<string, number>();
    // What this sketch and later ones measure cannot drive its dimensions.
    const later = new Set(this.measures.filter((r) => r.index >= index).map((r) => r.name));
    for (const dimension of sketch.constraints.filter(isDimension)) {
      if (dimension.reference) {
        const taken = dimension.name && !this.measures.some((r) => r.sketch === sketch.id && r.dimension === dimension.id);
        if (taken) return unsolved(`The name "${dimension.name}" is already used by a parameter or another reference dimension.`, frame.value);
        continue;
      }
      const read = later.size ? this.usesAny(dimension.expression, later) : undefined;
      if (read) return unsolved(`${constraintLabels[dimension.kind]} "${dimension.expression}" uses ${read}, which this sketch or a later one measures: a reference cannot drive what it measures.`, frame.value);
      const value = this.dimension(dimension);
      if (!value.ok) return unsolved(value.error.message, frame.value);
      values.set(dimension.id, value.value);
    }
    const drag = this.drag?.sketch === sketch.id ? this.drag : undefined;
    const fonts = importedFonts(this.engines.documents, this.engines.assets);
    let solution = await this.engines.sketches.solve(sketch, values, drag, fonts);
    // Drawings kept as one piece follow their handle points: when solving moved them, place the drawing again and solve once more.
    if (solution.status !== 'over-constrained' && solution.status !== 'failed' && handlesMoved(sketch, solution.sketch)) {
      const again = await this.generated(solution.sketch, frame.value);
      if (!again.ok) return unsolved(again.error.message, frame.value);
      sketch = again.value;
      solution = await this.engines.sketches.solve(sketch, values, drag, fonts);
    }
    if (solution.status === 'over-constrained') {
      const removable = await this.removable(sketch, values, solution.conflicting, fonts);
      return unsolved(conflictMessage(sketch, solution.conflicting, (solution.redundant?.length ?? 0) > 0), frame.value, removable);
    }
    if (solution.status === 'failed') return unsolved('The sketch cannot satisfy these constraints. Check the dimension values.', frame.value);
    if (collapses(solution.sketch)) return unsolved('This would shrink a line, circle or arc to nothing.', frame.value);
    this.sketches.set(sketch.id, { ...solution, frame: frame.value, values: new Map([...values, ...solution.measured]) });
    this.measuredBy(sketch, solution.measured);
    return ok(undefined);
  }

  /**
   * The sketch with its projections refreshed from the bodies made so far: their points and curves
   * (ids `<projection>:<n>`) are replaced; relations to ones that no longer exist are dropped.
   */
  private async generated(sketch: Sketch, frame: PlaneFrame): Promise<Result<Sketch>> {
    const projections = sketch.entities.filter((e): e is SketchProjection => e.kind === 'projection');
    const drawings = sketch.entities.filter((e): e is SketchDrawing => e.kind === 'drawing');
    const equations = sketch.entities.filter((e): e is SketchEquation => e.kind === 'equation');
    const blocks = sketch.entities.filter((e): e is SketchInsertion => e.kind === 'block');
    if (!projections.length && !drawings.length && !equations.length && !blocks.length) return ok(sketch);
    const entities = sketch.entities.filter((e) => !generatorOf(sketch, e.id));
    for (const insertion of blocks) {
      const pieces = await this.blockPieces(insertion, sketch);
      if (!pieces.ok) return pieces;
      entities.push(...pieces.value);
    }
    for (const equation of equations) {
      const pieces = this.equationPieces(equation);
      if (!pieces.ok) return pieces;
      entities.push(...pieces.value);
    }
    for (const drawing of drawings) {
      const pieces = await this.drawingPieces(drawing, sketch);
      if (!pieces.ok) return pieces;
      entities.push(...pieces.value);
    }
    for (const projection of projections) {
      const curves = await this.engines.modeling.project(this.bodies, projection.refs, frame);
      if (!curves.ok) return fail({ code: 'lost-reference', message: `A projected edge no longer exists. Delete the projection and project again. (${curves.error.message})` });
      let n = 0;
      const points: { at: Vec2; id: string }[] = [];
      const pointAt = (p: Vec2): string => {
        const found = points.find((q) => Math.hypot(q.at[0] - p[0], q.at[1] - p[1]) < 1e-7);
        if (found) return found.id;
        const id = `${projection.id}:${++n}`;
        points.push({ at: p, id });
        entities.push({ id, kind: 'point', x: p[0], y: p[1] });
        return id;
      };
      const construction = projection.construction;
      for (const c of curves.value) {
        if (c.kind === 'line') {
          const [start, end] = [pointAt(c.start), pointAt(c.end)];
          entities.push({ id: `${projection.id}:${++n}`, kind: 'line', start, end, construction });
        } else if (c.kind === 'circle') {
          const center = pointAt(c.center);
          entities.push({ id: `${projection.id}:${++n}`, kind: 'circle', center, radius: c.radius, construction });
        } else {
          const [center, start, end] = [pointAt(c.center), pointAt(c.start), pointAt(c.end)];
          entities.push({ id: `${projection.id}:${++n}`, kind: 'arc', center, start, end, construction });
        }
      }
    }
    const ids = new Set([sketchOriginId, ...entities.map((e) => e.id)]);
    const constraints = sketch.constraints.filter((c) => references(c).every((r) => ids.has(r)));
    return ok({ ...sketch, entities, constraints });
  }

  /**
   * The relations and dimensions whose removal would let an over-constrained sketch solve: among
   * those the solver names and those on the same points and curves (the solver may name only one).
   */
  private async removable(sketch: Sketch, values: ReadonlyMap<string, number>, conflicting: readonly string[], fonts: FontFiles): Promise<string[]> {
    const named = sketch.constraints.filter((c) => conflicting.includes(c.id));
    const involved = new Set(named.flatMap(references));
    const suspects = sketch.constraints.filter((c) => conflicting.includes(c.id) || references(c).some((r) => involved.has(r))).slice(0, 40);
    const removable: string[] = [];
    for (const suspect of suspects) {
      const trial = await this.engines.sketches.solve({ ...sketch, constraints: sketch.constraints.filter((c) => c !== suspect) }, values, undefined, fonts);
      if (trial.status !== 'over-constrained' && trial.status !== 'failed') removable.push(suspect.id);
    }
    return removable;
  }

  /** A part's sizes in millimetres and radians: from the catalogue and its expressions, with fits applied. */
  private partSolid(part: PartSpec, operation: BodyOperation): Result<PartSolid> {
    const lengths = (entries: Record<string, string>): Result<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const [name, expression] of Object.entries(entries)) {
        const kind = name.endsWith('Angle') || name === 'angle' ? 'angle' : scalars.has(name) ? 'scalar' : 'length';
        const value = this.value(expression, kind, name);
        if (!value.ok) return value;
        out[name] = value.value;
      }
      return ok(out);
    };
    const num = (values: Record<string, number>, name: string) => values[name] as number;
    switch (part.kind) {
      case 'screw': {
        const size = metric[part.size];
        const v = lengths({ length: part.length });
        return v.ok ? ok({ kind: 'screw', diameter: size.d, length: num(v.value, 'length'), head: size.head.diameter, headHeight: size.head.height, socket: size.head.socket }) : v;
      }
      case 'nut':
        return ok({ kind: 'nut', diameter: metric[part.size].d, acrossFlats: metric[part.size].nut.acrossFlats, height: metric[part.size].nut.height });
      case 'washer': {
        const { inner, outer, thickness } = metric[part.size].washer;
        return ok({ kind: 'ring', inner, outer, height: thickness, below: false });
      }
      case 'insert': {
        const { diameter, length } = metric[part.size].insert;
        return ok({ kind: 'ring', inner: metric[part.size].d, outer: diameter, height: length, below: true });
      }
      case 'bearing': {
        const { bore, outer, width } = bearings[part.size];
        return ok({ kind: 'ring', inner: bore, outer, height: width, below: false });
      }
      case 'magnet': {
        const v = lengths({ diameter: part.diameter, height: part.height });
        return v.ok ? ok({ kind: 'post', diameter: num(v.value, 'diameter'), height: num(v.value, 'height'), chamfer: 0 }) : v;
      }
      case 'peg': {
        const v = lengths({ diameter: part.diameter, height: part.height });
        // A peg is made smaller, by its fit and the printer's compensation.
        return v.ok ? ok({ kind: 'post', diameter: num(v.value, 'diameter') - fitAllowance[part.fit] - this.compensation, height: num(v.value, 'height'), chamfer: 0.4 }) : v;
      }
      case 'gear': {
        const v = lengths({ module: part.module, teeth: part.teeth, width: part.width, bore: part.bore, pressureAngle: part.pressureAngle, helixAngle: part.helixAngle, chamfer: part.chamfer ?? '0 mm', shift: part.shift ?? '0' });
        if (!v.ok) return v;
        const g = v.value;
        return ok({ kind: 'gear', module: num(g, 'module'), teeth: num(g, 'teeth'), width: num(g, 'width'), bore: num(g, 'bore'), pressureAngle: num(g, 'pressureAngle'), helixAngle: num(g, 'helixAngle'), chamfer: num(g, 'chamfer'), shift: num(g, 'shift') });
      }
      case 'bevel-gear': {
        const v = lengths({ module: part.module, teeth: part.teeth, mateTeeth: part.mateTeeth, shaftAngle: part.shaftAngle, faceWidth: part.faceWidth, bore: part.bore, pressureAngle: part.pressureAngle });
        if (!v.ok) return v;
        const g = v.value;
        const shaftAngle = num(g, 'shaftAngle');
        if (!(shaftAngle > 0 && shaftAngle < Math.PI)) return fail({ code: 'invalid-input', message: 'The shaft angle must be between 0° and 180°.' });
        if (!(num(g, 'mateTeeth') >= 6)) return fail({ code: 'invalid-input', message: 'The mate needs at least 6 teeth.' });
        const { pitchAngle } = bevelMesh(num(g, 'module'), Math.round(num(g, 'teeth')), Math.round(num(g, 'mateTeeth')), shaftAngle);
        return ok({ kind: 'bevel-gear', module: num(g, 'module'), teeth: num(g, 'teeth'), pitchAngle, faceWidth: num(g, 'faceWidth'), bore: num(g, 'bore'), pressureAngle: num(g, 'pressureAngle') });
      }
      case 'worm':
      case 'worm-wheel': {
        const sizes = part.kind === 'worm' ? { length: part.length } : { teeth: part.teeth, width: part.width };
        const v = lengths({ module: part.module, starts: part.starts, leadAngle: part.leadAngle, bore: part.bore, pressureAngle: part.pressureAngle, ...sizes });
        if (!v.ok) return v;
        const g = v.value;
        const lead = num(g, 'leadAngle');
        if (!(lead > 0 && lead <= Math.PI / 4)) return fail({ code: 'invalid-input', message: 'The lead angle must be between 0° and 45°.' });
        return part.kind === 'worm'
          ? ok({ kind: 'worm', module: num(g, 'module'), starts: num(g, 'starts'), diameter: wormMesh(num(g, 'module'), Math.round(num(g, 'starts')), lead, 1).worm, length: num(g, 'length'), bore: num(g, 'bore'), pressureAngle: num(g, 'pressureAngle') })
          : ok({ kind: 'worm-wheel', module: num(g, 'module'), teeth: num(g, 'teeth'), leadAngle: lead, width: num(g, 'width'), bore: num(g, 'bore'), pressureAngle: num(g, 'pressureAngle') });
      }
      case 'compression-spring':
      case 'extension-spring':
      case 'torsion-spring': {
        const v = lengths({ wire: part.wire, outside: part.outside, turns: part.turns, ...(part.kind === 'extension-spring' ? {} : { pitch: part.pitch }), ...(part.kind === 'torsion-spring' ? { legs: part.legs } : {}) });
        if (!v.ok) return v;
        const g = v.value;
        const [wire, mean, turns] = [num(g, 'wire'), num(g, 'outside') - num(g, 'wire'), num(g, 'turns')];
        const size: SpringSize =
          part.kind === 'compression-spring'
            ? { kind: 'compression', wire, mean, pitch: num(g, 'pitch'), turns, ends: part.ends }
            : part.kind === 'extension-spring'
              ? { kind: 'extension', wire, mean, turns }
              : { kind: 'torsion', wire, mean, pitch: num(g, 'pitch'), turns, legs: num(g, 'legs') };
        return ok({ kind: 'spring', size });
      }
      case 'ring-gear': {
        const v = lengths({ module: part.module, teeth: part.teeth, width: part.width, outside: part.outside, pressureAngle: part.pressureAngle, helixAngle: part.helixAngle });
        if (!v.ok) return v;
        const g = v.value;
        return ok({ kind: 'ring-gear', module: num(g, 'module'), teeth: num(g, 'teeth'), width: num(g, 'width'), outside: num(g, 'outside'), pressureAngle: num(g, 'pressureAngle'), helixAngle: num(g, 'helixAngle') });
      }
      case 'rack': {
        const v = lengths({ module: part.module, teeth: part.teeth, width: part.width, height: part.height, pressureAngle: part.pressureAngle });
        if (!v.ok) return v;
        const g = v.value;
        return ok({ kind: 'rack', module: num(g, 'module'), teeth: num(g, 'teeth'), width: num(g, 'width'), height: num(g, 'height'), pressureAngle: num(g, 'pressureAngle') });
      }
      case 'snap-fit': {
        const v = lengths({ length: part.length, width: part.width, thickness: part.thickness, hook: part.hook });
        if (!v.ok) return v;
        return ok({ kind: 'snap-fit', length: num(v.value, 'length'), width: num(v.value, 'width'), thickness: num(v.value, 'thickness'), hook: num(v.value, 'hook') });
      }
      case 'dovetail': {
        const v = lengths({ width: part.width, depth: part.depth, length: part.length, angle: part.angle });
        if (!v.ok) return v;
        // Cut into a body it is a slot: wider by the fit.
        const widen = operation === 'cut' ? fitAllowance[part.fit] + this.compensation : 0;
        return ok({ kind: 'dovetail', width: num(v.value, 'width') + widen, depth: num(v.value, 'depth'), length: num(v.value, 'length'), angle: num(v.value, 'angle') });
      }
      case 'living-hinge': {
        const v = lengths({ length: part.length, width: part.width, depth: part.depth });
        return v.ok ? ok({ kind: 'groove', length: num(v.value, 'length'), width: num(v.value, 'width'), depth: num(v.value, 'depth') }) : v;
      }
    }
  }

  /** Components read for the blocks they hold, once per regeneration. */
  private readonly blockDocuments = new Map<string, Promise<ComponentDocument | undefined>>();

  /** A block sketch: solved earlier in this run, or as last stored (later in the timeline, or in another component). */
  private async blockSketch(insertion: SketchInsertion): Promise<Sketch | undefined> {
    let timeline = this.timeline;
    if (insertion.document) {
      let loading = this.blockDocuments.get(insertion.document);
      if (!loading) {
        loading = this.engines.documents.load(asDocumentId(insertion.document)).then((d) => (d?.kind === 'component' ? d : undefined));
        this.blockDocuments.set(insertion.document, loading);
      }
      timeline = (await loading)?.timeline ?? [];
    }
    const stored = timeline.find((item): item is Sketch => item.id === insertion.block && isSketch(item));
    if (!stored?.block) return undefined;
    const solved = insertion.document ? undefined : this.sketches.get(stored.id);
    return solved && !solved.error ? solved.sketch : stored;
  }

  /**
   * The curves, points and texts of a block placed in a sketch (ADR-54a): turned and scaled about the
   * block's origin and moved to the insertion's point, fixed for the solver. What the block itself
   * places of this sketch is left out, so a sketch never holds itself.
   */
  private async blockPieces(insertion: SketchInsertion, sketch: Sketch): Promise<Result<SketchEntity[]>> {
    if (insertion.block === sketch.id && !insertion.document) return fail({ code: 'invalid-input', message: 'A block cannot be placed in itself.' });
    const block = await this.blockSketch(insertion);
    if (!block) return fail({ code: 'missing-input', message: `The block ${insertion.block} no longer exists. Explode or delete its placement.` });
    const angle = this.value(insertion.angle, 'angle', 'Block angle');
    if (!angle.ok) return angle;
    const scale = this.value(insertion.scale, 'scalar', 'Block scale');
    if (!scale.ok) return scale;
    if (!(scale.value > 0)) return fail({ code: 'invalid-expression', message: 'A block is scaled by more than zero.' });
    const origin = sketch.entities.find((e) => e.id === insertion.origin);
    const at: Vec2 = origin?.kind === 'point' ? [origin.x, origin.y] : [0, 0];
    const [cos, sin, s] = [Math.cos(angle.value), Math.sin(angle.value), scale.value];
    const place = (x: number, y: number): Vec2 => [at[0] + s * (cos * x - sin * y), at[1] + s * (sin * x + cos * y)];
    const placedHere = (id: string) => {
      const owner = generatorOf(block, id);
      return owner?.kind === 'block' && owner.block === sketch.id && !owner.document;
    };
    const content = block.entities.filter((e) => (e.kind === 'point' || isCurve(e) || e.kind === 'text') && !placedHere(e.id));
    const id = (ref: string) => insertedId(insertion.id, ref);
    const pieces: SketchEntity[] = [];
    if (content.some((e) => references(e).includes(sketchOriginId))) {
      pieces.push({ id: id(sketchOriginId), kind: 'point', x: at[0], y: at[1] });
    }
    const construction = (e: { readonly construction: boolean }) => e.construction || insertion.construction;
    for (const e of content) {
      switch (e.kind) {
        case 'point': {
          const [x, y] = place(e.x, e.y);
          pieces.push({ id: id(e.id), kind: 'point', x, y });
          break;
        }
        case 'line':
          pieces.push({ ...e, id: id(e.id), start: id(e.start), end: id(e.end), construction: construction(e) });
          break;
        case 'circle':
          pieces.push({ ...e, id: id(e.id), center: id(e.center), radius: e.radius * s, construction: construction(e) });
          break;
        case 'arc':
          pieces.push({ ...e, id: id(e.id), center: id(e.center), start: id(e.start), end: id(e.end), construction: construction(e) });
          break;
        case 'ellipse':
          pieces.push({ ...e, id: id(e.id), center: id(e.center), major: id(e.major), minorRadius: e.minorRadius * s, construction: construction(e) });
          break;
        case 'spline':
          pieces.push({ ...e, id: id(e.id), points: e.points.map(id), construction: construction(e) });
          break;
        case 'text':
          pieces.push({ ...e, id: id(e.id), anchor: id(e.anchor), height: e.height * s, angle: e.angle + angle.value, construction: construction(e), ...(e.along ? { along: { ...e.along, curve: id(e.along.curve), offset: e.along.offset * s } } : {}) });
          break;
      }
    }
    return ok(pieces);
  }

  /** The points an equation curve passes through, and the smooth curve through them. */
  private equationPieces(equation: SketchEquation): Result<SketchEntity[]> {
    const from = this.value(equation.from, 'scalar', 't from');
    if (!from.ok) return from;
    const to = this.value(equation.to, 'scalar', 't to');
    if (!to.ok) return to;
    const samples = Math.min(400, Math.max(3, Math.round(equation.samples)));
    const at: Vec2[] = [];
    for (let i = 0; i < samples; i++) {
      const scope = new Map(this.scope).set('t', { value: from.value + ((to.value - from.value) * i) / (samples - 1), length: 0, angle: 0 });
      const x = this.engines.parameters.evaluate(equation.x, 'length', scope);
      const y = this.engines.parameters.evaluate(equation.y, 'length', scope);
      if (!x.ok || !y.ok) return fail({ code: 'invalid-expression', message: `Equation curve "${!x.ok ? equation.x : equation.y}": ${(!x.ok ? x : (y as { error: { message: string } })).error.message}` });
      at.push([x.value, y.value]);
    }
    // It closes when it ends where it starts.
    const first = at[0] as Vec2;
    const last = at[at.length - 1] as Vec2;
    const closed = Math.hypot(last[0] - first[0], last[1] - first[1]) < 1e-6 * Math.max(1, ...at.map((p) => Math.hypot(p[0], p[1])));
    const points = (closed ? at.slice(0, -1) : at).map((p, i): SketchEntity => ({ id: `${equation.id}:${i + 1}`, kind: 'point', x: p[0], y: p[1] }));
    return ok([...points, { id: `${equation.id}:curve`, kind: 'spline', points: points.map((p) => p.id), closed, construction: equation.construction }]);
  }

  /**
   * The curves and texts of a drawing kept as one piece, placed by its handle points: the bottom left of
   * the drawing at `origin`, its width along to `handle`.
   */
  private async drawingPieces(drawing: SketchDrawing, sketch: Sketch): Promise<Result<SketchEntity[]>> {
    const read = await this.readDrawing(drawing.document, `${drawing.id}:`, drawing.trace);
    if (!read.ok) return read;
    const { entities, extent } = read.value;
    const at = (id: string): Vec2 => {
      const p = sketch.entities.find((e) => e.id === id);
      return p?.kind === 'point' ? [p.x, p.y] : [0, 0];
    };
    const [o, h] = [at(drawing.origin), at(drawing.handle)];
    const width = Math.max(extent.max[0] - extent.min[0], 1e-9);
    const scale = Math.hypot(h[0] - o[0], h[1] - o[1]) / width;
    const turn = Math.atan2(h[1] - o[1], h[0] - o[0]);
    const [cos, sin] = [Math.cos(turn) * scale, Math.sin(turn) * scale];
    const place = (x: number, y: number): Vec2 => {
      const [u, v] = [x - extent.min[0], y - extent.min[1]];
      return [o[0] + u * cos - v * sin, o[1] + u * sin + v * cos];
    };
    const construction = drawing.construction;
    return ok(
      entities.map((e): SketchEntity => {
        switch (e.kind) {
          case 'point': {
            const [x, y] = place(e.x, e.y);
            return { ...e, x, y };
          }
          case 'circle':
            return { ...e, radius: e.radius * scale, construction };
          case 'ellipse':
            return { ...e, minorRadius: e.minorRadius * scale, construction };
          case 'text':
            return { ...e, height: e.height * scale, angle: e.angle + turn, construction };
          case 'line':
          case 'arc':
          case 'spline':
            return { ...e, construction };
          default:
            return e;
        }
      }),
    );
  }

  /** An imported drawing's entities (ids with the prefix), read once per original. */
  private async readDrawing(documentId: string, prefix: string, trace?: TraceSettings): Promise<Result<DrawingEntities>> {
    const document = await this.engines.documents.load(asDocumentId(documentId));
    if (document?.kind !== 'imported' || isModelFormat(document.format) || isFontFormat(document.format)) {
      return fail({ code: 'missing-input', message: 'Its imported drawing was deleted. Delete the drawing from the sketch.' });
    }
    const key = `${document.assetId}|${prefix}|${trace ? JSON.stringify(trace) : ''}`;
    let cached = drawingCache.get(key);
    if (!cached) {
      cached = (async () => {
        const original = await this.engines.assets.fetch(document.assetId);
        if (!original) return fail({ code: 'missing-input', message: 'The original of its imported drawing is missing.' });
        return this.engines.interchange.readDrawing(original.bytes, document.format as 'dxf' | 'svg' | 'png' | 'jpg', prefix, trace);
      })();
      drawingCache.set(key, cached);
      if (drawingCache.size > 32) drawingCache.delete(drawingCache.keys().next().value as string);
    }
    return cached;
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
      const frame = await this.constructionPlane(feature);
      if (!frame.ok) return frame;
      this.planes.set(feature.id, frame.value);
      return ok(undefined);
    }
    if (feature.type === 'helix') {
      const helix = await this.helix(feature);
      if (!helix.ok) return helix;
      this.helices.set(feature.id, helix.value);
      return ok(undefined);
    }
    const request = await this.request(feature);
    if (!request.ok) return request;
    const outcome = await this.engines.modeling.apply(request.value);
    if (outcome.error) return fail({ code: 'feature-failed', message: outcome.error });
    // A spring made as a body of its own has a rate (CAD-161).
    if (request.value.type === 'part' && request.value.solid.kind === 'spring') {
      const before = new Set(this.bodies.map((b) => b.id));
      for (const body of outcome.bodies) if (!before.has(body.id)) this.springs.set(body.id, request.value.solid.size);
    }
    this.bodies = outcome.bodies;
    if (outcome.toolKey && isToolFeature(feature)) {
      this.tools.set(feature.id, { feature: feature.id, toolKey: outcome.toolKey, operation: feature.operation });
    }
    if (outcome.toolKey && feature.type === 'hole') this.tools.set(feature.id, { feature: feature.id, toolKey: outcome.toolKey, operation: 'cut' });
    if (outcome.toolKey && feature.type === 'rib') this.tools.set(feature.id, { feature: feature.id, toolKey: outcome.toolKey, operation: 'join' });
    if (outcome.thread) this.threads.push(outcome.thread);
    if (outcome.flanges) this.flanges.push(...outcome.flanges);
    return ok(undefined);
  }

  /** The kernel request for a feature, with expressions evaluated and references resolved. */
  private async request(feature: Exclude<Feature, { type: 'plane' | 'helix' }>): Promise<Result<ModelingRequest>> {
    const base = { feature: feature.id, bodies: this.bodies };
    const withKey = (body: WithoutKey<ModelingRequest>): Result<ModelingRequest> =>
      ok({ ...body, key: contentHash({ ...body, bodies: this.bodies.map((b) => b.key) }) } as ModelingRequest);
    switch (feature.type) {
      case 'insert': {
        const document = await this.engines.documents.load(asDocumentId(feature.document));
        const format = document?.kind === 'imported' ? document.format : undefined;
        if (!document || document.kind !== 'imported' || !isModelFormat(format)) {
          return fail({ code: 'missing-input', message: 'Its imported 3D file was deleted or is not a 3D file.' });
        }
        const original = await this.engines.assets.fetch(document.assetId);
        if (!original) return fail({ code: 'missing-input', message: 'The original of its imported file is missing.' });
        const { parts, key } = await boardParts(this.engines, document, original.bytes);
        const sources = await this.engines.interchange.readSolids(original.bytes, format, `import:${key}`, parts);
        if (!sources.ok) return fail({ code: 'feature-failed', message: sources.error.message });
        return withKey({ ...base, type: 'insert', sources: sources.value });
      }
      case 'base-flange': {
        const rules = this.sheetRules(feature);
        if (!rules.ok) return rules;
        if (!(rules.value.thickness > 0)) return fail({ code: 'invalid-input', message: 'The sheet thickness must be greater than zero.' });
        if (rules.value.bendRadius < 0) return fail({ code: 'invalid-input', message: 'The bend radius cannot be negative.' });
        if (!(rules.value.kFactor >= 0 && rules.value.kFactor <= 1)) return fail({ code: 'invalid-input', message: 'The K-factor lies between 0 and 1.' });
        const view = this.sketches.get(feature.sketch);
        if (!view || view.error) return fail({ code: 'missing-input', message: 'Its sketch is missing, later in the timeline or does not solve.' });
        const profiles = view.profiles.filter((p) => feature.profiles.includes(p.id));
        if (profiles.length < feature.profiles.length || profiles.length === 0) {
          return fail({ code: 'missing-input', message: 'Some of its profiles no longer exist. Edit the feature and pick them again.' });
        }
        this.sheet = { frame: view.frame, profiles, rules: rules.value };
        return withKey({ ...base, type: 'extrude', frame: view.frame, profiles, distance: rules.value.thickness, direction: feature.direction, operation: 'new-body' });
      }
      case 'edge-flange':
      case 'hem':
      case 'miter-flange': {
        if (!this.sheet) return fail({ code: 'missing-input', message: 'Flanges and hems need a base flange earlier in the timeline.' });
        const { thickness, bendRadius, relief } = this.sheet.rules;
        // Earlier flanges matter only for the corners a relief is cut at.
        const sheet = { thickness, bendRadius, ...(relief ? { relief, flanges: [...this.flanges] } : {}) };
        if (feature.type === 'miter-flange') {
          const path = this.path(feature.sketch);
          if (!path.ok) return path;
          if (path.value.flat.closed) return fail({ code: 'invalid-input', message: 'A miter flange profile is an open chain of lines.' });
          return withKey({ ...base, type: 'miter-flange', edges: feature.edges, profile: path.value.pieces, frame: path.value.frame, ...sheet });
        }
        const length = this.value(feature.length, 'length', 'Length');
        if (!length.ok) return length;
        if (feature.type === 'hem') {
          const gap = feature.style === 'closed' ? ok(0) : this.value(feature.gap, 'length', 'Gap');
          if (!gap.ok) return gap;
          return withKey({ ...base, type: 'hem', edges: feature.edges, style: feature.style, gap: gap.value, length: length.value, ...sheet });
        }
        const angle = this.value(feature.angle, 'angle', 'Angle');
        if (!angle.ok) return angle;
        return withKey({ ...base, type: 'edge-flange', edges: feature.edges, length: length.value, angle: angle.value, ...sheet });
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
        if (feature.type === 'fillet' && feature.endSize?.trim()) {
          const endSize = this.value(feature.endSize, 'length', 'End radius');
          if (!endSize.ok) return endSize;
          return withKey({ ...base, type: 'fillet', edges: feature.edges, size: size.value, endSize: endSize.value });
        }
        return withKey({ ...base, type: feature.type, edges: feature.edges, size: size.value });
      }
      case 'draft': {
        const angle = this.value(feature.angle, 'angle', 'Angle');
        if (!angle.ok) return angle;
        const plane = await this.frame(feature.plane);
        if (!plane.ok) return plane;
        return withKey({ ...base, type: 'draft', faces: feature.faces, plane: plane.value, angle: angle.value });
      }
      case 'rib': {
        const next = feature.extent === 'next';
        const [thickness, depth] = [this.value(feature.thickness, 'length', 'Thickness'), next ? ok(0) : this.value(feature.depth, 'length', 'Depth')];
        if (!thickness.ok) return thickness;
        if (!depth.ok) return depth;
        const path = this.path(feature.sketch);
        if (!path.ok) return path;
        if (path.value.flat.closed) return fail({ code: 'invalid-input', message: 'A rib is drawn as an open line or curve; closed outlines are extruded.' });
        return withKey({ ...base, type: 'rib', frame: path.value.frame, path: path.value.pieces, thickness: thickness.value, depth: next ? 'next' : depth.value, direction: feature.direction });
      }
      case 'wrap': {
        const depth = this.value(feature.depth, 'length', 'Depth');
        if (!depth.ok) return depth;
        const view = this.sketches.get(feature.sketch);
        if (!view || view.error) return fail({ code: 'missing-input', message: 'Its sketch is missing, later in the timeline or does not solve.' });
        const profiles = view.profiles.filter((p) => feature.profiles.includes(p.id));
        if (profiles.length < feature.profiles.length || profiles.length === 0) {
          return fail({ code: 'missing-input', message: 'Some of its profiles no longer exist. Edit the feature and pick them again.' });
        }
        return withKey({ ...base, type: 'wrap', frame: view.frame, profiles, face: feature.face, method: feature.method, depth: depth.value, operation: feature.operation });
      }
      case 'shell': {
        const thickness = this.value(feature.thickness, 'length', 'Thickness');
        if (!thickness.ok) return thickness;
        return withKey({ ...base, type: 'shell', faces: feature.faces, thickness: thickness.value });
      }
      case 'loft': {
        if (feature.sections.length < 2) return fail({ code: 'missing-input', message: 'Pick profiles of at least two sketches.' });
        const sections: { frame: PlaneFrame; profile: Profile }[] = [];
        for (const section of feature.sections) {
          const view = this.sketches.get(section.sketch);
          const profile = view?.profiles.find((p) => p.id === section.profile);
          if (!view || view.error || !profile) return fail({ code: 'missing-input', message: 'A section is missing, later in the timeline or no longer a profile. Edit the loft and pick it again.' });
          sections.push({ frame: view.frame, profile });
        }
        return withKey({ ...base, type: 'loft', sections, ruled: feature.ruled, operation: feature.operation });
      }
      case 'sweep': {
        const view = this.sketches.get(feature.sketch);
        if (!view || view.error) return fail({ code: 'missing-input', message: 'Its sketch is missing, later in the timeline or does not solve.' });
        const profiles = view.profiles.filter((p) => feature.profiles.includes(p.id));
        if (profiles.length < feature.profiles.length || profiles.length === 0) {
          return fail({ code: 'missing-input', message: 'Some of its profiles no longer exist. Edit the feature and pick them again.' });
        }
        const helix = this.helices.get(feature.path);
        if (helix) return withKey({ ...base, type: 'sweep', frame: view.frame, profiles, path: [{ kind: 'helix', ...helix } satisfies HelixPiece], closed: false, operation: feature.operation });
        const path = this.path(feature.path);
        if (!path.ok) return path;
        return withKey({ ...base, type: 'sweep', frame: view.frame, profiles, path: path.value.pieces, closed: path.value.flat.closed, operation: feature.operation });
      }
      case 'path-pattern': {
        const tools = feature.features.map((id) => this.tools.get(id));
        if (tools.some((t) => !t) || tools.length === 0) {
          return fail({ code: 'missing-input', message: 'It repeats features that are missing, failed or come later in the timeline.' });
        }
        const count = this.value(feature.count, 'scalar', 'Count');
        if (!count.ok) return count;
        if (!Number.isInteger(count.value) || count.value < 2) return fail({ code: 'invalid-input', message: 'A pattern needs a whole number of at least 2 copies.' });
        if (this.helices.has(feature.path)) return fail({ code: 'invalid-input', message: 'A pattern runs along the curves of a sketch, not a helix.' });
        const path = this.path(feature.path);
        if (!path.ok) return path;
        return withKey({ ...base, type: 'path-pattern', tools: tools as ToolInput[], placements: placementsAlong(path.value.flat, path.value.frame, count.value, feature.align) });
      }
      case 'part': {
        const view = this.sketches.get(feature.sketch);
        if (!view || view.error) return fail({ code: 'missing-input', message: 'Its sketch is missing, later in the timeline or does not solve.' });
        const points = placementPoints(view.sketch, feature.points);
        if (points.some((p) => !p)) return fail({ code: 'missing-input', message: `Some of its points no longer exist (${missingPoints(view.sketch, feature.points)}). Edit the part and pick its sketch again.` });
        const angle = this.value(feature.angle, 'angle', 'Angle');
        if (!angle.ok) return angle;
        const solid = this.partSolid(feature.part, feature.operation);
        if (!solid.ok) return solid;
        return withKey({ ...base, type: 'part', frame: view.frame, points: points as { id: string; at: Vec2 }[], angle: angle.value, flip: feature.flip, solid: solid.value, operation: feature.operation });
      }
      case 'hole': {
        const view = this.sketches.get(feature.sketch);
        if (!view || view.error) return fail({ code: 'missing-input', message: 'Its sketch is missing, later in the timeline or does not solve.' });
        const points = placementPoints(view.sketch, feature.points);
        if (points.some((p) => !p)) return fail({ code: 'missing-input', message: `Some of its points no longer exist (${missingPoints(view.sketch, feature.points)}). Edit the hole and pick its sketch again.` });
        const size = (expression: string, what: string) => this.value(expression, 'length', what);
        const diameter = size(feature.diameter, 'Diameter');
        if (!diameter.ok) return diameter;
        let depth: number | undefined;
        let point: number | undefined;
        if (feature.extent === 'blind') {
          const value = size(feature.depth, 'Depth');
          if (!value.ok) return value;
          depth = value.value;
          if (feature.drillPoint) {
            const angle = this.value(feature.pointAngle?.trim() || '118 deg', 'angle', 'Point angle');
            if (!angle.ok) return angle;
            if (!(angle.value > 0 && angle.value < Math.PI)) return fail({ code: 'invalid-input', message: 'The point angle is between 0° and 180°.' });
            point = angle.value;
          }
        }
        let bore: { diameter: number; depth: number } | undefined;
        let sink: { diameter: number; angle: number } | undefined;
        if (feature.kind === 'counterbore') {
          const [d, h] = [size(feature.boreDiameter, 'Counterbore diameter'), size(feature.boreDepth, 'Counterbore depth')];
          if (!d.ok) return d;
          if (!h.ok) return h;
          bore = { diameter: d.value, depth: h.value };
        }
        if (feature.kind === 'countersink') {
          const [d, a] = [size(feature.sinkDiameter, 'Countersink diameter'), this.value(feature.sinkAngle, 'angle', 'Countersink angle')];
          if (!d.ok) return d;
          if (!a.ok) return a;
          sink = { diameter: d.value, angle: a.value };
        }
        // A fit widens the hole by its allowance and the printer's compensation.
        const widen = feature.fit ? fitAllowance[feature.fit] + this.compensation : 0;
        const spec = { diameter: diameter.value + widen, ...(depth === undefined ? {} : { depth }), ...(point === undefined ? {} : { point }), ...(bore ? { bore } : {}), ...(sink ? { sink } : {}), teardrop: feature.teardrop, bridge: feature.bridge && bore ? this.layer : 0 };
        return withKey({ ...base, type: 'hole', frame: view.frame, points: points as { id: string; at: Vec2 }[], spec });
      }
      case 'thread': {
        if (!feature.face.name) return fail({ code: 'missing-input', message: 'Click the wall of a hole or a shaft.' });
        const thread = metricThreads[feature.size];
        if (!thread) return fail({ code: 'invalid-input', message: `${feature.size} is not an ISO metric thread size.` });
        let length: number | undefined;
        if (feature.length.trim()) {
          const value = this.value(feature.length, 'length', 'Length');
          if (!value.ok) return value;
          length = value.value;
        }
        return withKey({ ...base, type: 'thread', face: feature.face, size: feature.size, ...thread, ...(length === undefined ? {} : { length }), modelled: feature.modelled, flip: feature.flip });
      }
      case 'combine':
        return withKey({ ...base, type: 'combine', target: feature.target, tools: feature.tools, operation: feature.operation, keepTools: feature.keepTools });
      case 'split': {
        const plane = await this.frame(feature.plane);
        if (!plane.ok) return plane;
        return withKey({ ...base, type: 'split', body: feature.body, plane: plane.value });
      }
      case 'move': {
        const [x, y, z] = feature.translate.map((e, i) => this.value(e, 'length', `${'XYZ'[i]} distance`));
        if (!x?.ok) return x as Result<never>;
        if (!y?.ok) return y as Result<never>;
        if (!z?.ok) return z as Result<never>;
        const angle = this.value(feature.angle, 'angle', 'Angle');
        if (!angle.ok) return angle;
        const axis = this.axis(feature.axis);
        if (!axis.ok) return axis;
        const rotation = angle.value !== 0 ? { axis: axis.value, angle: angle.value } : undefined;
        return withKey({ ...base, type: 'move', bodyIds: feature.bodies, translation: [x.value, y.value, z.value], ...(rotation ? { rotation } : {}), copy: feature.copy });
      }
      case 'scale': {
        const factor = this.value(feature.factor, 'scalar', 'Scale factor');
        if (!factor.ok) return factor;
        return withKey({ ...base, type: 'scale', bodyIds: feature.bodies, factor: factor.value });
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

  /** A base flange's rules, evaluated. */
  private sheetRules(feature: Extract<Feature, { type: 'base-flange' }>): Result<SheetView['rules']> {
    const thickness = this.value(feature.thickness, 'length', 'Sheet thickness');
    if (!thickness.ok) return thickness;
    const bendRadius = this.value(feature.bendRadius, 'length', 'Bend radius');
    if (!bendRadius.ok) return bendRadius;
    const kFactor = this.value(feature.kFactor, 'scalar', 'K-factor');
    if (!kFactor.ok) return kFactor;
    const rules = { thickness: thickness.value, bendRadius: bendRadius.value, kFactor: kFactor.value };
    if (!feature.cornerRelief) return ok(rules);
    const size = this.value(feature.reliefSize ?? '', 'length', 'Relief size');
    if (!size.ok) return size;
    if (!(size.value > 0)) return fail({ code: 'invalid-input', message: 'The relief size must be greater than zero.' });
    return ok({ ...rules, relief: { shape: feature.cornerRelief, size: size.value } });
  }

  /** The curves of a sketch as a path in world coordinates, in order. */
  private path(sketchId: string): Result<{ readonly flat: SketchPath; readonly frame: PlaneFrame; readonly pieces: readonly PathPiece[] }> {
    const view = this.sketches.get(sketchId);
    if (!view || view.error) return fail({ code: 'missing-input', message: 'Its path sketch is missing, later in the timeline or does not solve.' });
    const path = sketchPath(view.sketch);
    if (!path.ok) return path;
    const world = (p: Vec2): Vec3 => add(view.frame.origin, add(scale(view.frame.u, p[0]), scale(view.frame.v, p[1])));
    const pieces = path.value.pieces.map((p): PathPiece =>
      p.kind === 'bezier'
        ? { kind: 'bezier', points: p.points.map(world) as unknown as [Vec3, Vec3, Vec3, Vec3] }
        : p.kind === 'arc'
          ? { kind: 'arc', start: world(p.start), mid: world(p.mid), end: world(p.end) }
          : { kind: 'line', start: world(p.start), end: world(p.end) },
    );
    return ok({ flat: path.value, frame: view.frame, pieces });
  }

  /** A helix feature in space (CAD-161): about its plane's normal through the plane's origin. */
  private async helix(feature: Extract<Feature, { type: 'helix' }>): Promise<Result<HelixPath>> {
    const frame = await this.frame(feature.plane);
    if (!frame.ok) return frame;
    const diameter = this.value(feature.diameter, 'length', 'Diameter');
    if (!diameter.ok) return diameter;
    const pitch = this.value(feature.pitch, 'length', 'Pitch');
    if (!pitch.ok) return pitch;
    const taper = this.value(feature.taper || '0 deg', 'angle', 'Taper');
    if (!taper.ok) return taper;
    const extent = feature.extent === 'turns' ? this.value(feature.turns, 'scalar', 'Turns') : this.value(feature.height, 'length', 'Height');
    if (!extent.ok) return extent;
    const height = feature.extent === 'turns' ? extent.value * pitch.value : extent.value;
    const radius = diameter.value / 2;
    if (!(radius > 0)) return fail({ code: 'invalid-input', message: 'The diameter must be greater than zero.' });
    if (!(pitch.value > 0)) return fail({ code: 'invalid-input', message: 'The pitch must be greater than zero.' });
    if (!(height > 0)) return fail({ code: 'invalid-input', message: feature.extent === 'turns' ? 'The turns must be more than zero.' : 'The height must be greater than zero.' });
    if (!(Math.abs(taper.value) < (80 * Math.PI) / 180)) return fail({ code: 'invalid-input', message: 'The taper must be less than 80°.' });
    if (!(radius + height * Math.tan(taper.value) > 0)) return fail({ code: 'invalid-input', message: 'The helix narrows to nothing before its end: use less taper.' });
    const { origin, u, v } = frame.value;
    return ok({ feature: feature.id, origin, axis: cross(u, v), x: u, radius, pitch: pitch.value, height, taper: taper.value, leftHanded: feature.leftHanded });
  }

  /** Where a construction plane lies, by its mode. */
  private async constructionPlane(feature: Extract<Feature, { type: 'plane' }>): Promise<Result<PlaneFrame>> {
    if (feature.mode === 'points') {
      if (feature.points.length !== 3) return fail({ code: 'missing-input', message: 'Pick three vertices.' });
      const points: Vec3[] = [];
      for (const ref of feature.points) {
        const point = await this.engines.modeling.pointOf(this.bodies, ref);
        if (!point.ok) return point;
        points.push(point.value);
      }
      const [p, q, r] = points as [Vec3, Vec3, Vec3];
      const u = sub(q, p);
      const n = cross(u, sub(r, p));
      if (length(n) < 1e-9 * Math.max(1, length(u) ** 2)) return fail({ code: 'invalid-input', message: 'The three points lie on one line.' });
      const normal = unit(n);
      return ok({ origin: p, u: unit(u), v: cross(normal, unit(u)) });
    }
    const base = await this.frame(feature.base);
    if (!base.ok) return base;
    const { origin, u, v } = base.value;
    const normal = cross(u, v);
    if (feature.mode === 'midplane') {
      const second = await this.frame(feature.second);
      if (!second.ok) return second;
      const other = cross(second.value.u, second.value.v);
      if (Math.abs(Math.abs(dot(normal, other)) - 1) > 1e-6) return fail({ code: 'invalid-input', message: 'A midplane lies between two parallel planes.' });
      const gap = dot(sub(second.value.origin, origin), normal);
      return ok({ ...base.value, origin: add(origin, scale(normal, gap / 2)) });
    }
    if (feature.mode === 'angle') {
      const angle = this.value(feature.angle, 'angle', 'Angle');
      if (!angle.ok) return angle;
      const axis = await this.axisLine(feature.axis);
      if (!axis.ok) return axis;
      // The axis, laid into the base plane, is the hinge the plane turns about.
      const along = sub(axis.value.direction, scale(normal, dot(axis.value.direction, normal)));
      if (length(along) < 1e-9) return fail({ code: 'invalid-input', message: 'The axis must lie in the base plane or run along it.' });
      const hinge = unit(along);
      const across = cross(normal, hinge);
      const turned = add(scale(normal, Math.cos(angle.value)), scale(across, -Math.sin(angle.value)));
      const point = add(axis.value.origin, scale(normal, -dot(sub(axis.value.origin, origin), normal)));
      return ok({ origin: point, u: hinge, v: cross(turned, hinge) });
    }
    const offset = this.value(feature.offset, 'length', 'Offset');
    if (!offset.ok) return offset;
    return ok({ ...base.value, origin: add(origin, scale(normal, offset.value)) });
  }

  /** An axis as a point and direction, with edges resolved on the bodies made so far. */
  private async axisLine(ref: AxisRef): Promise<Result<{ origin: Vec3; direction: Vec3 }>> {
    const axis = this.axis(ref);
    if (!axis.ok) return axis;
    if (!('edge' in axis.value)) return ok(axis.value);
    const frame = await this.engines.modeling.frameOf(this.bodies, axis.value.edge);
    if (!frame.ok) return frame;
    return ok({ origin: frame.value.origin, direction: cross(frame.value.u, frame.value.v) });
  }

  private async frame(ref: PlaneRef): Promise<Result<PlaneFrame>> {
    if (typeof ref === 'string') return ok(originFrames[ref]);
    if ('plane' in ref) {
      const frame = this.planes.get(ref.plane);
      return frame ? ok(frame) : fail({ code: 'missing-input', message: 'Its construction plane is missing, failed or comes later in the timeline.' });
    }
    if (!this.bodies.some((b) => b.id === ref.face.body)) {
      // Name the feature that made the body, when it failed (CAD-142).
      const maker = this.timeline.find((item) => item.id === ref.face.body.split(':')[0]);
      const status = maker && this.items.get(maker.id);
      const why = maker && status?.state === 'error' ? ` ${maker.name} failed: ${status.error}` : maker && status?.state === 'suppressed' ? ` ${maker.name} is suppressed.` : '';
      return fail({ code: 'missing-input', message: `The body of its face is missing at this point of the timeline.${why}` });
    }
    const frame = await this.engines.modeling.planeOf(this.bodies, ref.face);
    if (!frame.ok || !ref.anchor) return frame;
    // The face's plane, with the origin and u where the sketch was made (CAD-136).
    const { origin, u, v } = frame.value;
    const n = cross(u, v);
    const along = (p: Vec3, d: Vec3) => p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
    const lift = along([ref.anchor.origin[0] - origin[0], ref.anchor.origin[1] - origin[1], ref.anchor.origin[2] - origin[2]], n);
    const anchored: Vec3 = [ref.anchor.origin[0] - n[0] * lift, ref.anchor.origin[1] - n[1] * lift, ref.anchor.origin[2] - n[2] * lift];
    const w = along(ref.anchor.u, n);
    const flatU: Vec3 = [ref.anchor.u[0] - n[0] * w, ref.anchor.u[1] - n[1] * w, ref.anchor.u[2] - n[2] * w];
    const size = Math.hypot(...flatU);
    if (size < 1e-9) return frame;
    const au: Vec3 = [flatU[0] / size, flatU[1] / size, flatU[2] / size];
    return ok({ origin: anchored, u: au, v: cross(n, au) });
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
      const p = id === sketchOriginId ? undefined : view.sketch.entities.find((e) => e.id === id);
      const [x, y] = p?.kind === 'point' ? [p.x, p.y] : [0, 0];
      return add(view.frame.origin, add(scale(view.frame.u, x), scale(view.frame.v, y)));
    };
    const start = point(line.start);
    const end = point(line.end);
    return ok({ origin: start, direction: add(end, scale(start, -1)) });
  }
}

/**
 * Where each copy of a path pattern goes, relative to the path's start: shifted along it and, when
 * aligned, turned in the path's plane as the path turns.
 */
function placementsAlong(path: SketchPath, frame: PlaneFrame, count: number, align: boolean): Placement[] {
  const places = placesAlong(path, count);
  const world = (p: Vec2): Vec3 => add(frame.origin, add(scale(frame.u, p[0]), scale(frame.v, p[1])));
  const [first, ...rest] = places;
  if (!first) return [];
  const start = world(first.point);
  const normal = cross(frame.u, frame.v);
  const heading = (d: Vec2) => Math.atan2(d[1], d[0]);
  return rest.map((place): Placement => {
    const translation = sub(world(place.point), start);
    const angle = heading(place.direction) - heading(first.direction);
    return align && Math.abs(angle) > 1e-12 ? { translation, rotation: { origin: start, direction: normal, angle } } : { translation };
  });
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

/** A parameter's value as shown: lengths (and their powers) in the document's unit. */
function display(q: Quantity, unit: LengthUnit): string {
  const round = (v: number) => String(Math.round(v * 1000) / 1000);
  const value = q.value / lengthUnitSize[unit] ** q.length;
  if (q.length === 1 && q.angle === 0) return `${round(value)} ${unit}`;
  if (q.length === 0 && q.angle === 1) return `${round((q.value * 180) / Math.PI)}°`;
  if (q.length === 0 && q.angle === 0) return round(q.value);
  return `${round(value)} ${unit}^${q.length}`;
}
