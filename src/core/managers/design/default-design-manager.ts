import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ProjectAccess } from '@core/access/project';
import type { ExternalFileAccess } from '@core/access/external-file';
import {
  type BodyMesh,
  type BodyProperties,
  type BodyState,
  type ComponentDocument,
  type DocumentId,
  type DomainEvents,
  fail,
  isSketch,
  type ManufacturingProfile,
  manufacturingProfiles,
  type Material,
  materials,
  type Measurement,
  ok,
  type Parameter,
  type Result,
  resultStamp,
  type SimulationResult,
  type TopologyRef,
  type ValidationReport,
  type SketchConstraint,
  type SketchFreedom,
  isFontFormat,
  isModelFormat,
} from '@core/contracts';
import type { AnalysisEngine } from '@core/engines/analysis';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { ModelingEngine } from '@core/engines/modeling';
import type { ParameterEngine } from '@core/engines/parameter';
import { flatPattern } from '@core/engines/sheet-metal';
import { inferRelations, type SketchEngine } from '@core/engines/sketch';
import type { Clock } from '@core/utilities/clock';
import type { EventBus } from '@core/utilities/messaging';
import { type ConfigurationImport, configurationsCsv, readConfigurationsCsv } from './configurations';
import { type BrokenReference, brokenReferences } from './references';
import { applyCommand } from './commands';
import type {
  DesignCommand,
  DesignManager,
  DesignSession,
  ExportOptions,
  InsertDrawingOptions,
  DesignState,
  DrawingFormat,
  SketchView,
  SolidFormat,
} from './design-manager';
import { type Derived, importedFonts, Regeneration, type RegenerationContext } from './regeneration';

export interface DesignManagerDependencies {
  /** Where project parameters are read. */
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly sketches: SketchEngine;
  readonly parameters: ParameterEngine;
  readonly modeling: ModelingEngine;
  readonly interchange: InterchangeEngine;
  readonly analysis: AnalysisEngine;
  readonly assets: AssetAccess;
  readonly events: EventBus<DomainEvents>;
  readonly clock: Clock;
}

interface Snapshot {
  readonly document: ComponentDocument;
  readonly derived: Derived;
  readonly meshes: readonly BodyMesh[];
}

const historyLimit = 200;
const drawingTypes: Readonly<Record<DrawingFormat, string>> = { svg: 'image/svg+xml', dxf: 'image/vnd.dxf' };
const solidTypes: Readonly<Record<SolidFormat, string>> = {
  step: 'model/step',
  stl: 'model/stl',
  obj: 'model/obj',
  '3mf': 'model/3mf',
};

class Session implements DesignSession {
  private current: Snapshot;
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private readonly listeners = new Set<(state: DesignState) => void>();
  private readonly meshCache = new Map<string, BodyMesh>();
  private queue: Promise<unknown> = Promise.resolve();

  /** Listening for project parameter changes, while the session has listeners. */
  private projectWatch: (() => void) | undefined;

  constructor(
    private readonly deps: DesignManagerDependencies,
    initial: Snapshot,
    private readonly results: ResultPublisher,
    private context: RegenerationContext,
  ) {
    this.current = initial;
    for (const mesh of initial.meshes) this.meshCache.set(mesh.key, mesh);
  }

  /** Regenerates with the project's new parameters; the document itself does not change. */
  private async projectChanged(): Promise<void> {
    this.context = { ...this.context, projectParameters: await projectParametersOf(this.deps, this.current.document) };
    const derived = await new Regeneration(this.deps).run(this.current.document, this.context);
    await this.commit({ document: this.current.document, derived, meshes: await this.meshes(derived) });
  }

  state(): DesignState {
    const { document, derived, meshes } = this.current;
    return {
      document,
      sketches: derived.sketches,
      items: derived.items,
      planes: derived.planes,
      bodies: meshes,
      threads: derived.threads,
      sheetMetal: derived.sheet !== undefined,
      parameters: derived.parameters,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  subscribe(listener: (state: DesignState) => void): () => void {
    this.listeners.add(listener);
    const { projectId } = this.current.document;
    this.projectWatch ??= this.deps.events.subscribe('projectParametersChanged', (event) =>
      event.projectId === projectId ? void this.serialized(() => this.projectChanged()) : undefined,
    );
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.projectWatch?.();
        this.projectWatch = undefined;
      }
    };
  }

  /** Commands run one after another, so fast input (drags, typing) can never interleave. */
  execute(command: DesignCommand): Promise<Result<void>> {
    return this.serialized(() => this.apply(command));
  }

  undo(): Promise<void> {
    return this.serialized(() => this.travel(this.undoStack, this.redoStack));
  }

  redo(): Promise<void> {
    return this.serialized(() => this.travel(this.redoStack, this.undoStack));
  }

  async freedom(sketchId: string): Promise<SketchFreedom> {
    const view = this.current.derived.sketches.get(sketchId);
    if (!view || view.error) return { points: [], radii: [] };
    return this.deps.sketches.freedom(view.sketch, view.values);
  }

  async suggestConstraints(sketchId: string, idPrefix: string): Promise<SketchConstraint[]> {
    const view = this.current.derived.sketches.get(sketchId);
    if (!view || view.error) return [];
    return (await this.deps.sketches.suggest(view.sketch, view.values, idPrefix)).constraints;
  }

  async previewDrag(sketchId: string, pointId: string, x: number, y: number): Promise<SketchView | undefined> {
    const view = this.current.derived.sketches.get(sketchId);
    if (!view || view.error) return undefined;
    const solution = await this.deps.sketches.solve(view.sketch, view.values, { point: pointId, x, y }, importedFonts(this.deps.documents, this.deps.assets));
    if (solution.status === 'over-constrained' || solution.status === 'failed') return undefined;
    return { ...solution, frame: view.frame, values: view.values };
  }

  async exportSketch(sketchId: string, format: DrawingFormat, options: { readonly compensateKerf?: boolean } = {}): Promise<Result<void>> {
    const view = this.current.derived.sketches.get(sketchId);
    if (!view) return fail({ code: 'invalid-command', message: `Sketch ${sketchId} does not exist.` });
    const process = processOf(this.current.document);
    if (options.compensateKerf && process.kind !== 'laser') {
      return fail({ code: 'not-laser', message: 'Kerf compensation needs a laser cutter as manufacturing profile.' });
    }
    try {
      const kerf = options.compensateKerf && process.kind === 'laser' ? { profiles: view.profiles, kerf: process.kerf } : undefined;
      const bytes = await this.deps.interchange.exportDrawing(view.sketch, format, kerf, view.texts);
      const suffix = kerf ? ' (kerf compensated)' : '';
      await this.deps.externalFiles.deliver({
        name: `${this.current.document.name} - ${view.sketch.name}${suffix}.${format}`,
        mediaType: drawingTypes[format],
        bytes,
      });
      return ok(undefined);
    } catch (error) {
      return fail({ code: 'export-failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async insertDrawing(sketchId: string, documentId: DocumentId, idPrefix: string, options: InsertDrawingOptions = {}): Promise<Result<void>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'imported' || isModelFormat(document.format) || isFontFormat(document.format)) {
      return fail({ code: 'invalid-command', message: 'Only imported DXF and SVG drawings, and pictures to trace, can be inserted into a sketch.' });
    }
    const original = await this.deps.assets.fetch(document.assetId);
    if (!original) return fail({ code: 'missing-original', message: `The original of ${document.name} is missing.` });
    const picture = document.format === 'png' || document.format === 'jpg';
    const trace = picture ? (options.trace ?? { threshold: 0.5, smooth: true }) : undefined;
    const drawing = await this.deps.interchange.readDrawing(original.bytes, document.format, idPrefix, trace);
    if (!drawing.ok) return drawing;
    const { entities, extent } = drawing.value;
    if (options.onePiece) {
      // The handles sit at the bottom corners of the drawing: it starts where it was drawn, at its own size.
      const [origin, handle, id] = [`${idPrefix}o`, `${idPrefix}h`, `${idPrefix}d`];
      return this.execute({
        type: 'add-sketch-geometry',
        sketchId,
        entities: [
          { id: origin, kind: 'point', x: extent.min[0], y: extent.min[1] },
          { id: handle, kind: 'point', x: extent.max[0], y: extent.min[1] },
          { id, kind: 'drawing', document: documentId, origin, handle, construction: false, ...(trace ? { trace } : {}) },
        ],
        constraints: [],
      });
    }
    return this.execute({ type: 'add-sketch-geometry', sketchId, entities, constraints: inferRelations(entities, options.relations ?? 'none', idPrefix) });
  }

  async exportFlatPattern(format: DrawingFormat): Promise<Result<void>> {
    const { document, derived } = this.current;
    if (!derived.sheet) return fail({ code: 'not-sheet-metal', message: 'Only sheet metal parts (with a base flange) can be laid flat.' });
    const pattern = flatPattern(derived.sheet.frame, derived.sheet.profiles, derived.flanges, derived.sheet.rules);
    if (!pattern.ok) return pattern;
    const bytes = await this.deps.interchange.exportOutlines(pattern.value.cuts, pattern.value.bends, format);
    await this.deps.externalFiles.deliver({ name: `${document.name} - flat pattern.${format}`, mediaType: drawingTypes[format], bytes });
    return ok(undefined);
  }

  /** The parameters in effect: the project's, and the component's own (which win by name). */
  private parametersInEffect(): Parameter[] {
    const own = this.current.document.parameters;
    const names = new Set(own.map((p) => p.name));
    return [...(this.context.projectParameters ?? []).filter((p) => !names.has(p.name)), ...own];
  }

  async brokenReferences(itemId: string): Promise<Result<readonly BrokenReference[]>> {
    const { document } = this.current;
    const index = document.timeline.findIndex((i) => i.id === itemId);
    const item = document.timeline[index];
    if (!item) return fail({ code: 'invalid-command', message: `Item ${itemId} does not exist.` });
    // The bodies as they are just before the item.
    const before = await new Regeneration(this.deps).run({ ...document, rollbackIndex: Math.max(document.rollbackIndex, document.timeline.length - index) }, this.context);
    return ok(brokenReferences(item, await this.meshes(before)));
  }

  async exportConfigurations(): Promise<Result<void>> {
    const { document } = this.current;
    const csv = configurationsCsv(document.configurations ?? [], this.parametersInEffect().map((p) => p.name));
    await this.deps.externalFiles.deliver({ name: `${document.name} configurations.csv`, mediaType: 'text/csv', bytes: new TextEncoder().encode(csv) });
    return ok(undefined);
  }

  readConfigurations(csv: string): Result<ConfigurationImport> {
    return readConfigurationsCsv(csv, this.parametersInEffect(), this.current.document.configurations ?? [], this.deps.parameters);
  }

  async exportViewer(): Promise<Result<void>> {
    const { document } = this.current;
    const names = new Map(this.namedBodies(this.current.derived).map((b) => [b.id, b.name]));
    const parts = this.state()
      .bodies.filter((body) => !document.appearances?.[body.body]?.hidden)
      .map((body) => {
        const look = document.appearances?.[body.body];
        return { name: names.get(body.body) ?? body.body, ...(look?.color ? { color: look.color } : {}), opacity: look?.opacity ?? 1, positions: body.positions, normals: body.normals, indices: body.indices, edges: body.edgePositions };
      });
    if (parts.length === 0) return fail({ code: 'nothing-to-export', message: 'There are no bodies to show yet.' });
    // Loaded when needed: the viewer page is large and rarely made.
    const { viewerHtml } = await import('@core/utilities/viewer');
    const bytes = new TextEncoder().encode(viewerHtml({ title: document.name, parts }));
    await this.deps.externalFiles.deliver({ name: `${document.name}.html`, mediaType: 'text/html', bytes });
    return ok(undefined);
  }

  async exportBodies(format: SolidFormat, options: ExportOptions = {}): Promise<Result<void>> {
    const { document } = this.current;
    // Another configuration is built for the export only; the session keeps showing its own.
    const other = options.configuration !== undefined && options.configuration !== (document.configuration ?? '');
    const derived = other ? await new Regeneration(this.deps).run(document, { ...this.context, configuration: options.configuration }) : this.current.derived;
    const bodies = this.namedBodies(derived).filter((b) => !options.bodies || options.bodies.includes(b.id));
    if (derived.bodies.length === 0) return fail({ code: 'nothing-to-export', message: 'There are no bodies to export yet.' });
    if (bodies.length === 0) return fail({ code: 'nothing-to-export', message: 'Select at least one body to export.' });
    const variant = document.configurations?.find((c) => c.id === (other ? options.configuration : document.configuration))?.name;
    try {
      const bytes = await this.deps.interchange.exportBodies(bodies, format, options.quality);
      await this.deps.externalFiles.deliver({ name: `${document.name}${variant ? ` (${variant})` : ''}.${format}`, mediaType: solidTypes[format], bytes });
      return ok(undefined);
    } catch (error) {
      return fail({ code: 'export-failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  measure(refs: readonly TopologyRef[]): Promise<Result<Measurement>> {
    return this.deps.analysis.measure(this.current.derived.bodies, refs);
  }

  properties(): Promise<BodyProperties[]> {
    return this.deps.analysis.properties(this.current.derived.bodies, materialOf(this.current.document).density);
  }

  async validate(): Promise<ValidationReport> {
    const { document, derived } = this.current;
    const profile = processOf(document);
    const sketches = [...derived.sketches.values()].filter((v) => !v.error).map((v) => ({ sketch: v.sketch, profiles: v.profiles }));
    const checks = await this.deps.analysis.validate({ bodies: this.namedBodies(), sketches }, profile);
    return { profile, checks };
  }

  async simulate(): Promise<Result<SimulationResult>> {
    const { document, derived } = this.current;
    if (!document.simulation) return fail({ code: 'not-fixed', message: 'Hold at least one face fixed.' });
    // Materials saved before strength checks have no stiffness: those of the catalogue's namesake stand in.
    const material = materialOf(document);
    const known = materials.find((m) => m.name === material.name);
    // Copies: buffers sent to the geometry worker move there, and the view keeps drawing these meshes.
    const meshes = (await this.meshes(derived)).map((m) => ({ ...m, positions: m.positions.slice(), normals: m.normals.slice(), indices: m.indices.slice(), edgePositions: m.edgePositions.slice() }));
    return this.deps.analysis.simulate(meshes, document.simulation, { ...known, ...material });
  }

  /** Bodies with the names of the features that made them. */
  private namedBodies(derived: Derived = this.current.derived) {
    const { document } = this.current;
    return derived.bodies.map((b) => ({ ...b, name: document.timeline.find((item) => item.id === b.id)?.name ?? b.id }));
  }

  private async apply(command: DesignCommand): Promise<Result<void>> {
    if (command.type === 'set-appearance' && !this.current.derived.bodies.some((b) => b.id === command.body)) {
      return fail({ code: 'invalid-command', message: `There is no body ${command.body}.` });
    }
    const applied = applyCommand(this.current.document, command);
    if (!applied.ok) return applied;
    const { document, target, drag } = applied.value;
    const derived = await new Regeneration(this.deps, drag).run(document, this.context);
    if (applied.value.parameters) {
      if (derived.parameterError) return fail(derived.parameterError);
      // A parameter change must not break anything that worked before.
      for (const [id, status] of derived.items) {
        if (status.state === 'error' && this.current.derived.items.get(id)?.state === 'ok') {
          const item = document.timeline.find((i) => i.id === id);
          return fail({ code: 'breaks-model', message: `${item?.name ?? id} would fail: ${status.error}` });
        }
      }
    }
    const status = target ? derived.items.get(target) : undefined;
    if (status?.state === 'error') {
      // Contradicting relations point at the ones the sketch had before, so the client can offer to remove one.
      const before = target ? this.current.derived.sketches.get(target)?.sketch.constraints.map((c) => c.id) : undefined;
      const view = target ? derived.sketches.get(target) : undefined;
      const involved = view?.conflicting?.filter((id) => view.sketch.constraints.some((c) => c.id === id));
      const related = involved?.filter((id) => before?.includes(id));
      return fail({ code: errorCode(status.error), message: status.error ?? 'This change fails.', ...(related?.length ? { related } : {}), ...(involved?.length ? { involved } : {}) });
    }
    // Solved positions become the stored ones, so a drag stays where it was dropped.
    const timeline = document.timeline.map((item) => (isSketch(item) ? (derived.sketches.get(item.id)?.error ? item : (derived.sketches.get(item.id)?.sketch ?? item)) : item));
    const next = { ...document, timeline, modifiedAt: this.deps.clock().toISOString() };
    this.undoStack.push(this.current);
    if (this.undoStack.length > historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    await this.commit({ document: next, derived, meshes: await this.meshes(derived) });
    return ok(undefined);
  }

  /** Tessellates only bodies whose shape changed. */
  private async meshes(derived: Derived): Promise<BodyMesh[]> {
    const missing = derived.bodies.filter((b) => !this.meshCache.has(b.key));
    if (missing.length) for (const mesh of await this.deps.modeling.tessellate(missing)) this.meshCache.set(mesh.key, mesh);
    return derived.bodies.map((b) => this.meshCache.get(b.key) as BodyMesh);
  }

  private async travel(from: Snapshot[], to: Snapshot[]): Promise<void> {
    const target = from.pop();
    if (!target) return;
    to.push(this.current);
    await this.commit(target);
  }

  private async commit(snapshot: Snapshot): Promise<void> {
    this.current = snapshot;
    await this.deps.documents.store(snapshot.document);
    this.deps.events.publish('documentSaved', { projectId: snapshot.document.projectId, documentId: snapshot.document.id });
    const state = this.state();
    for (const listener of this.listeners) listener(state);
    await this.results.publish(snapshot.document, snapshot.derived.bodies, this.context.projectParameters, snapshot.document.configuration);
    const { configuration } = snapshot.document;
    this.deps.events.publish('resultPublished', { documentId: snapshot.document.id, ...(configuration ? { configuration } : {}) });
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** The parameters of the component's project. */
async function projectParametersOf(deps: DesignManagerDependencies, document: ComponentDocument): Promise<readonly Parameter[]> {
  return (await deps.projects.find(document.projectId))?.parameters ?? [];
}

const materialOf = (document: ComponentDocument): Material => document.material ?? (materials[0] as Material);
const processOf = (document: ComponentDocument): ManufacturingProfile => document.process ?? (manufacturingProfiles[0] as ManufacturingProfile);

/** Stable error codes for the kinds of failure the messages describe. */
function errorCode(message: string | undefined): string {
  if (!message) return 'failed';
  if (message.includes('conflicts with existing constraints') || message.includes('already set by existing constraints')) return 'over-constrained';
  if (message.includes('shrink a line')) return 'degenerate';
  if (message.includes('": ')) return 'invalid-expression';
  return 'feature-failed';
}

/**
 * Publishes component results for assemblies (docs/Architecture/Decisions.md#adr-11). Snapshots are
 * reused while the bodies are unchanged, so most edits only re-stamp the result.
 */
class ResultPublisher {
  private last: { readonly keys: string; readonly bytes: Uint8Array } | undefined;

  constructor(private readonly deps: DesignManagerDependencies) {}

  async publish(document: ComponentDocument, bodies: readonly BodyState[], projectParameters: readonly Parameter[] = [], configuration?: string): Promise<void> {
    const keys = bodies.map((b) => b.key).join('|');
    if (this.last?.keys !== keys) this.last = { keys, bytes: await this.deps.modeling.snapshot(bodies) };
    const stamp = resultStamp(document.modifiedAt, projectParameters);
    await this.deps.assets.publishResult({ documentId: document.id, projectId: document.projectId, stamp, bytes: this.last.bytes, ...(configuration ? { configuration } : {}) });
  }
}

export class DefaultDesignManager implements DesignManager {
  constructor(private readonly deps: DesignManagerDependencies) {
    deps.events.subscribe('regenerateComponent', ({ documentId, configuration }) => this.regenerate(documentId, configuration));
    deps.events.subscribe('documentDeleted', ({ documentId }) => deps.assets.discardResult(documentId));
  }

  async open(documentId: DocumentId): Promise<Result<DesignSession>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'component') {
      return fail({ code: 'unknown-document', message: `Component ${documentId} does not exist.` });
    }
    const context = { projectParameters: await projectParametersOf(this.deps, document) };
    const derived = await new Regeneration(this.deps).run(document, context);
    const meshes = derived.bodies.length ? await this.deps.modeling.tessellate(derived.bodies) : [];
    return ok(new Session(this.deps, { document, derived, meshes }, new ResultPublisher(this.deps), context));
  }

  /** Answers a queued `regenerateComponent` request (for one configuration) with `componentRegenerated`. */
  private async regenerate(documentId: DocumentId, configuration?: string): Promise<void> {
    const answer = (ok: boolean) => this.deps.events.publish('componentRegenerated', { documentId, ...(configuration ? { configuration } : {}), ok });
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'component' || (configuration && !document.configurations?.some((c) => c.id === configuration))) return answer(false);
    const projectParameters = await projectParametersOf(this.deps, document);
    const derived = await new Regeneration(this.deps).run(document, { projectParameters, configuration: configuration ?? '' });
    await new ResultPublisher(this.deps).publish(document, derived.bodies, projectParameters, configuration);
    answer(true);
  }
}
