import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import type { ProjectAccess } from '@core/access/project';
import {
  type AssemblyDocument,
  type BodyState,
  type CadDocument,
  type ComponentDocument,
  type DocumentId,
  type DomainEvents,
  type DrawingDocument,
  type DrawingView,
  fail,
  materialNames,
  ok,
  type Parameter,
  type Result,
  resultStamp,
  sourceKey,
  type Vec2,
} from '@core/contracts';
import type { ModelingEngine, ViewGeometry, ViewRequest } from '@core/engines/modeling';
import type { ParameterEngine } from '@core/engines/parameter';
import type { Clock } from '@core/utilities/clock';
import type { EventBus } from '@core/utilities/messaging';
import { encodePng } from '@core/utilities/picture';
import type { TextFont, TextWeight } from '@core/utilities/text';
import { holeCallout } from './callouts';
import { applyCommand } from './commands';
import type { DrawingCommand, DrawingManager, DrawingSession, DrawingState, SheetLayout } from './drawing-manager';
import { sheetDxf, sheetPdf, sheetPixels } from './exports';
import { layoutSheet, type PartsList, viewAxes } from './layout';

export interface DrawingManagerDependencies {
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly modeling: ModelingEngine;
  readonly parameters: ParameterEngine;
  readonly events: EventBus<DomainEvents>;
  readonly clock: Clock;
  /** The bundled fonts, for pictures of the sheet. */
  readonly fonts: (weight: TextWeight) => Promise<TextFont>;
  /**
   * A kernel of its own that draws views exactly and is stopped when a view takes too long
   * (`stoppable`, CAD-125); such a view is drawn from the triangles by `modeling` instead. Absent:
   * `modeling` draws views exactly, however long they take.
   */
  readonly views?: Pick<ModelingEngine, 'restore' | 'drawView'>;
  /**
   * A kernel of its own that draws, without a time limit and one at a time, the views `views` ran
   * out of time on; each replaces the view drawn from the triangles when it is done (CAD-168).
   */
  readonly exact?: Pick<ModelingEngine, 'restore' | 'drawView'>;
}

interface Source {
  readonly status: 'loading' | 'ready' | 'missing';
  readonly message?: string;
  readonly bodies: readonly BodyState[];
  /** The published result the bodies are read from, for the views kernel. */
  readonly bytes?: Uint8Array;
  readonly stamp: string;
  readonly document?: CadDocument;
}

type Drawn = ViewGeometry | { readonly error: string };

const historyLimit = 200;
const maxRequests = 3;
/**
 * Drawn views are kept as the drawing's result (CAD-125), so other processes need not draw them
 * again. The stamp changes when what a drawn view holds changes.
 */
const drawnStamp = 'views:4';
const drawing = 'Drawing…';

interface ExactJob {
  readonly key: string;
  /** Whether the view is still wanted: shown, or its drawing closed (the result is kept for next time). */
  readonly wanted: () => boolean;
  readonly run: (engine: Pick<ModelingEngine, 'restore' | 'drawView'>) => Promise<Result<ViewGeometry>>;
  readonly done: (geometry: ViewGeometry) => Promise<void>;
}

/**
 * Views drawn exactly without a time limit after they took too long (CAD-168): one at a time, in a
 * views kernel of their own, for every drawing the manager opens.
 */
class ExactViews {
  private readonly waiting: ExactJob[] = [];
  private readonly queued = new Set<string>();
  private running = false;

  constructor(private readonly engine: Pick<ModelingEngine, 'restore' | 'drawView'> | undefined) {}

  /** Whether a view is waiting or being drawn. */
  has(key: string): boolean {
    return this.queued.has(key);
  }

  add(job: ExactJob): void {
    if (!this.engine || this.queued.has(job.key)) return;
    this.queued.add(job.key);
    this.waiting.push(job);
    void this.next();
  }

  private async next(): Promise<void> {
    const engine = this.engine;
    if (this.running || !engine) return;
    const job = this.waiting.shift();
    if (!job) return;
    this.running = true;
    try {
      if (job.wanted()) {
        const drawn = await job.run(engine);
        if (drawn.ok) await job.done(drawn.value);
      }
    } catch {
      // Drawn from the triangles it stays.
    } finally {
      this.running = false;
      this.queued.delete(job.key);
      void this.next();
    }
  }
}

class Session implements DrawingSession {
  private layout: SheetLayout;
  /** By `sourceKey`: a component (or a configuration of it) or an assembly. */
  private readonly sources = new Map<string, Source>();
  /** Drawn views by what they show (`viewKey`), also those read from the drawing's result. */
  private readonly geometry = new Map<string, Drawn>();
  private readonly requests = new Map<string, number>();
  private readonly undoStack: DrawingDocument[] = [];
  private readonly redoStack: DrawingDocument[] = [];
  private readonly listeners = new Set<(state: DrawingState) => void>();
  private readonly unsubscribe: (() => void)[];
  private queue: Promise<unknown> = Promise.resolve();
  private projectParameters: readonly Parameter[] = [];
  private closed = false;

  constructor(
    private readonly deps: DrawingManagerDependencies,
    private document: DrawingDocument,
    private readonly exact: ExactViews,
  ) {
    this.layout = layoutSheet({ document, geometry: new Map(), callouts: new Map(), parts: new Map() });
    const { events } = deps;
    // A configuration's events reach the views of it; a document's reach all views of it, and assemblies using it.
    const reload = (id: DocumentId, reason: 'regenerated' | 'failed' | 'changed', configuration?: string | null) => {
      const keys = [...this.sources.keys()].filter((key) => (configuration === undefined ? key.split('@')[0] === id : key === sourceKey(id, configuration ?? undefined)));
      return keys.length || this.partsOf(id) ? this.serialized(() => this.refresh(id, keys, reason)) : undefined;
    };
    this.unsubscribe = [
      events.subscribe('componentRegenerated', ({ documentId, configuration, ok: done }) => reload(documentId, done ? 'regenerated' : 'failed', configuration ?? null)),
      events.subscribe('resultPublished', ({ documentId, configuration }) => reload(documentId, 'changed', configuration ?? null)),
      events.subscribe('documentChanged', ({ documentId }) => reload(documentId, 'changed')),
      events.subscribe('documentRenamed', ({ documentId }) => reload(documentId, 'changed')),
      events.subscribe('documentRestored', ({ documentId }) => reload(documentId, 'changed')),
      events.subscribe('documentDeleted', ({ documentId }) => reload(documentId, 'changed')),
    ];
  }

  /** Whether an assembly shown in a view uses the document (its parts list names it). */
  private partsOf(id: DocumentId): boolean {
    return [...this.sources.values()].some((s) => s.document?.kind === 'assembly' && s.document.instances.some((i) => i.component === id));
  }

  /** The sources the views show: components (or configurations of them) and assemblies, by `sourceKey`. */
  private keysOf(document: DrawingDocument): Set<string> {
    return new Set(document.views.filter((v) => !v.detail).map((v) => sourceKey(v.source, v.configuration)));
  }

  async start(): Promise<void> {
    this.projectParameters = (await this.deps.projects.find(this.document.projectId))?.parameters ?? [];
    const kept = await this.deps.assets.latestResult(this.document.id);
    if (kept?.stamp === drawnStamp) {
      try {
        for (const [key, geometry] of Object.entries(JSON.parse(new TextDecoder().decode(kept.bytes)) as Record<string, ViewGeometry>)) this.geometry.set(key, geometry);
      } catch {
        // A damaged cache is drawn again.
      }
    }
    for (const key of this.keysOf(this.document)) await this.load(key, 'open');
    await this.relayout();
  }

  state(): DrawingState {
    const material = this.material();
    return { document: this.document, layout: this.layout, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0, ...(material ? { material } : {}) };
  }

  /** The material of the first component the views show, which the title block shows unless it names its own (CAD-127). */
  private material(): string | undefined {
    for (const view of this.document.views) {
      const source = this.sources.get(sourceKey(view.source, view.configuration))?.document;
      if (source?.kind === 'component') return materialNames(source);
    }
    return undefined;
  }

  subscribe(listener: (state: DrawingState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    for (const source of this.sources.values()) void this.deps.modeling.keep(source.bodies, false);
    for (const stop of this.unsubscribe) stop();
    this.listeners.clear();
  }

  /** Puts a loaded source in place of the one before, holding its shapes in the shape store while views show it (CAD-121). */
  private hold(key: string, next: Source): void {
    const before = this.sources.get(key)?.bodies ?? [];
    this.sources.set(key, next);
    if (before === next.bodies) return;
    void this.deps.modeling.keep(next.bodies, true);
    void this.deps.modeling.keep(before, false);
  }

  execute(command: DrawingCommand): Promise<Result<void>> {
    return this.serialized(() => this.apply(command));
  }

  undo(): Promise<void> {
    return this.serialized(() => this.travel(this.undoStack, this.redoStack));
  }

  redo(): Promise<void> {
    return this.serialized(() => this.travel(this.redoStack, this.undoStack));
  }

  async exportPdf(): Promise<Result<void>> {
    await this.queue;
    const bytes = sheetPdf(this.layout, this.document.titleBlock.title || this.document.name);
    await this.deps.externalFiles.deliver({ name: `${this.document.name}.pdf`, mediaType: 'application/pdf', bytes });
    return ok(undefined);
  }

  async exportDxf(): Promise<Result<void>> {
    await this.queue;
    const bytes = new TextEncoder().encode(sheetDxf(this.layout));
    await this.deps.externalFiles.deliver({ name: `${this.document.name}.dxf`, mediaType: 'image/vnd.dxf', bytes });
    return ok(undefined);
  }

  async picture(options: { readonly width?: number; readonly view?: string } = {}): Promise<Result<Uint8Array>> {
    await this.queue;
    const width = Math.round(options.width ?? 1600);
    if (!(width > 0 && width <= 8000)) return fail({ code: 'invalid-picture', message: 'A picture is 1 to 8000 pixels wide.' });
    const view = options.view === undefined ? undefined : this.layout.views.find((v) => v.id === options.view);
    if (options.view !== undefined && !view) return fail({ code: 'invalid-picture', message: `There is no view "${options.view}".` });
    // A view with room around it for its dimensions and label.
    const region = view && { min: [view.min[0] - 15, view.min[1] - 15] as Vec2, max: [view.max[0] + 15, view.max[1] + 15] as Vec2 };
    return ok(await encodePng(await sheetPixels(this.layout, this.deps.fonts, { width, ...(region ? { region } : {}) })));
  }

  catchUp(): Promise<void> {
    return this.serialized(async () => {
      let changed = false;
      for (const [key, source] of [...this.sources]) {
        if (source.status !== 'ready') continue;
        // Changed since it was read (an assembly's result can lag behind its document: not the stamp).
        const document = await this.deps.documents.load(key.split('@')[0] as DocumentId);
        if (document?.modifiedAt === source.document?.modifiedAt) continue;
        await this.load(key, 'changed');
        changed = true;
      }
      if (changed) await this.relayout();
    });
  }

  async configurationsOf(source: DocumentId): Promise<readonly { readonly id: string; readonly name: string }[]> {
    const document = await this.deps.documents.load(source);
    return document?.kind === 'component' ? (document.configurations ?? []).map(({ id, name }) => ({ id, name })) : [];
  }

  private async apply(command: DrawingCommand): Promise<Result<void>> {
    if ((command.type === 'add-view' || command.type === 'edit-view') && !command.view.detail) {
      const { view } = command;
      const source = await this.deps.documents.load(view.source);
      if (!source || source.projectId !== this.document.projectId || (source.kind !== 'component' && source.kind !== 'assembly')) {
        return fail({ code: 'invalid-command', message: 'A view shows a component or an assembly of this project.' });
      }
      const configurations = source.kind === 'component' ? (source.configurations ?? []) : [];
      if (view.configuration !== undefined && !configurations.some((c) => c.id === view.configuration)) {
        const known = configurations.map((c) => `${c.id} (${c.name})`).join(', ');
        return fail({ code: 'invalid-command', message: `${source.name} has no configuration ${view.configuration}${known ? `; its configurations are ${known}` : ''}.` });
      }
    }
    const applied = applyCommand(this.document, command);
    if (!applied.ok) return applied;
    this.undoStack.push(this.document);
    if (this.undoStack.length > historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    await this.commit({ ...applied.value, modifiedAt: this.deps.clock().toISOString() });
    return ok(undefined);
  }

  private async travel(from: DrawingDocument[], to: DrawingDocument[]): Promise<void> {
    const target = from.pop();
    if (!target) return;
    to.push(this.document);
    await this.commit(target);
  }

  private async commit(document: DrawingDocument): Promise<void> {
    this.document = document;
    for (const key of this.keysOf(document)) if (!this.sources.has(key)) await this.load(key, 'open');
    await this.deps.documents.store(document);
    this.deps.events.publish('documentSaved', { projectId: document.projectId, documentId: document.id });
    await this.relayout();
  }

  private async refresh(id: DocumentId, keys: readonly string[], reason: 'regenerated' | 'failed' | 'changed'): Promise<void> {
    for (const key of keys) await this.load(key, reason);
    // A component of a shown assembly: its name or material in the parts list.
    if (!keys.length) for (const [key, loaded] of this.sources) if (loaded.document?.kind === 'assembly') await this.load(key, 'changed');
    await this.relayout();
  }

  /**
   * Reads a view's source from its published result: a component's (asked for again when stale,
   * like the Assembly Manager does) or an assembly's (published by its editor).
   */
  private async load(key: string, reason: 'open' | 'regenerated' | 'failed' | 'changed'): Promise<void> {
    const [id, configuration] = key.split('@') as [DocumentId, string | undefined];
    const document = await this.deps.documents.load(id);
    const previous = this.sources.get(key);
    const missing = (message: string) => this.hold(key, { status: 'missing', message, bodies: [], stamp: '', ...(document ? { document } : {}) });
    if (!document || (document.kind !== 'component' && document.kind !== 'assembly')) return void missing('The document of this view is gone.');
    if (configuration && (document.kind !== 'component' || !document.configurations?.some((c) => c.id === configuration))) return void missing(`${document.name} no longer has this configuration.`);
    if (reason === 'failed') return void missing(`${document.name} cannot be built.`);
    const result = await this.deps.assets.latestResult(id, configuration);
    if (document.kind === 'assembly') {
      if (!result) return void missing(`Open ${document.name} once, so its parts are placed for drawings.`);
    } else if (result?.stamp !== resultStamp(document.modifiedAt, this.projectParameters)) {
      const requests = this.requests.get(key) ?? 0;
      if (reason === 'regenerated' && requests >= maxRequests) return void missing(`${document.name} cannot be built.`);
      this.requests.set(key, requests + 1);
      this.hold(key, { status: 'loading', bodies: previous?.bodies ?? [], stamp: previous?.stamp ?? '', document });
      this.deps.events.publish('regenerateComponent', { documentId: id, ...(configuration ? { configuration } : {}) });
      return;
    }
    if (!result) return void missing(`${document.name} has no result yet.`);
    this.requests.delete(key);
    const bodies = previous?.stamp === result.stamp && previous.status === 'ready' ? previous.bodies : await this.deps.modeling.restore(result.bytes, `result:${key}:${result.stamp}`);
    this.hold(key, { status: 'ready', bodies, ...(this.deps.views ? { bytes: result.bytes } : {}), stamp: result.stamp, document });
  }

  /**
   * Draws every view (from cache where nothing changed) and lays out the sheet. Views still to be
   * drawn show *Drawing…* on a sheet laid out first, so the others are seen meanwhile (CAD-125).
   */
  private async relayout(): Promise<void> {
    const shown = new Map<string, { view: DrawingView; source: Source; key: string }>();
    const geometry = new Map<string, Drawn>();
    for (const view of this.document.views.filter((v) => !v.detail)) {
      const source = this.sources.get(sourceKey(view.source, view.configuration));
      if (!source || source.status !== 'ready') {
        geometry.set(view.id, { error: source?.status === 'missing' ? (source.message ?? 'Missing.') : 'Loading…' });
        continue;
      }
      const key = viewKey(view, source.stamp);
      shown.set(view.id, { view, source, key });
      geometry.set(view.id, this.geometry.get(key) ?? { error: drawing });
    }
    const missing = [...shown.values()].filter(({ key }) => !this.geometry.has(key));
    if (missing.length) {
      await this.publishLayout(geometry);
      for (const { view, source, key } of missing) {
        // Two views of the same: drawn once.
        if (!this.geometry.has(key)) this.geometry.set(key, await this.draw(view, source));
        geometry.set(view.id, this.geometry.get(key) as Drawn);
      }
      await this.keepDrawn([...shown.values()].map((s) => s.key));
    }
    // Those drawn from the triangles are drawn exactly meanwhile (CAD-168).
    for (const { view, source, key } of shown.values()) {
      const drawn = this.geometry.get(key);
      if (drawn && 'approximate' in drawn && drawn.approximate) this.finishExactly(view, source, key);
    }
    const finishing = new Set([...shown].filter(([, { key }]) => this.exact.has(`${this.document.id}|${key}`)).map(([id]) => id));
    await this.publishLayout(geometry, finishing);
  }

  /** Has a view that was drawn from the triangles drawn exactly, without a time limit, to replace it (CAD-168). */
  private finishExactly(view: DrawingView, source: Source, key: string): void {
    const bytes = source.bytes;
    if (!bytes) return;
    const request = this.requestOf(view, source);
    this.exact.add({
      key: `${this.document.id}|${key}`,
      wanted: () => this.closed || this.inUse(key),
      // A copy: the bytes go over to the kernel's worker, and the session keeps them.
      run: async (engine) => engine.drawView(shownBy(view, await engine.restore(bytes.slice(), `result:${sourceKey(view.source, view.configuration)}:${source.stamp}`)), request),
      done: (geometry) => this.finished(key, geometry),
    });
  }

  /** Whether a drawn view is one the drawing shows now. */
  private inUse(key: string): boolean {
    return this.document.views.some((view) => {
      const source = !view.detail && this.sources.get(sourceKey(view.source, view.configuration));
      return source && source.status === 'ready' && viewKey(view, source.stamp) === key;
    });
  }

  /** An exact view in place of the one drawn from the triangles: kept with the drawing, and shown when it is open. */
  private finished(key: string, geometry: ViewGeometry): Promise<void> {
    return this.serialized(async () => {
      this.geometry.set(key, geometry);
      const kept = await this.deps.assets.latestResult(this.document.id);
      let views: Record<string, ViewGeometry> = {};
      try {
        if (kept?.stamp === drawnStamp) views = JSON.parse(new TextDecoder().decode(kept.bytes)) as Record<string, ViewGeometry>;
      } catch {
        // A damaged cache is replaced.
      }
      const bytes = new TextEncoder().encode(JSON.stringify({ ...views, [key]: geometry }));
      await this.deps.assets.publishResult({ documentId: this.document.id, projectId: this.document.projectId, stamp: drawnStamp, bytes });
      if (!this.closed) await this.relayout();
    });
  }

  /** How the modeling engine is asked for a view: its direction, hidden lines and section; the parts of an assembly by instance (CAD-167). */
  private requestOf(view: DrawingView, source: Source): ViewRequest {
    const { u, v } = viewAxes[view.direction];
    return { frame: { origin: [0, 0, 0], u, v }, hidden: view.hidden, ...(view.section ? { cut: view.section } : {}), ...(source.document?.kind === 'assembly' ? { prefixed: true } : {}) };
  }

  private async publishLayout(geometry: ReadonlyMap<string, Drawn>, finishing?: ReadonlySet<string>): Promise<void> {
    const material = this.material();
    this.layout = layoutSheet({ document: this.document, geometry, callouts: this.callouts(geometry), parts: await this.partsLists(), ...(material ? { material } : {}), ...(finishing?.size ? { finishing } : {}) });

    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  /** Draws a view exactly, in the views kernel when there is one; one that takes too long there is drawn from the triangles. */
  private async draw(view: DrawingView, source: Source): Promise<Drawn> {
    const request = this.requestOf(view, source);
    const { views, modeling } = this.deps;
    let drawn: Result<ViewGeometry> | undefined;
    if (views && source.bytes) {
      try {
        // A copy: the bytes go over to the kernel's worker, and later views need them again.
        drawn = await views.drawView(shownBy(view, await views.restore(source.bytes.slice(), `result:${sourceKey(view.source, view.configuration)}:${source.stamp}`)), request);
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') drawn = await modeling.drawView(shownBy(view, source.bodies), { ...request, method: 'mesh' });
      }
    }
    drawn ??= await modeling.drawView(shownBy(view, source.bodies), request);
    return drawn.ok ? drawn.value : { error: drawn.error.message };
  }

  /** Keeps the drawn views in use with the drawing, for other processes (CAD-125). */
  private async keepDrawn(keys: readonly string[]): Promise<void> {
    const kept = Object.fromEntries(keys.flatMap((key) => {
      const geometry = this.geometry.get(key);
      return geometry && !('error' in geometry) ? [[key, geometry]] : [];
    }));
    const bytes = new TextEncoder().encode(JSON.stringify(kept));
    await this.deps.assets.publishResult({ documentId: this.document.id, projectId: this.document.projectId, stamp: drawnStamp, bytes });
  }

  /** The text of each hole callout, from the hole feature of the circle it points at. */
  private callouts(geometry: ReadonlyMap<string, Drawn>): Map<string, readonly string[]> {
    const texts = new Map<string, readonly string[]>();
    for (const annotation of this.document.annotations) {
      if (annotation.kind !== 'callout') continue;
      const view = this.document.views.find((v) => v.id === annotation.circle.view);
      const drawn = view && geometry.get(view.detail?.of ?? view.id);
      const circle = drawn && !('error' in drawn) ? drawn.circles.find((c) => c.name === annotation.circle.name) : undefined;
      const shown = view && this.document.views.find((v) => v.id === (view.detail?.of ?? view.id));
      const component = shown && this.sources.get(sourceKey(shown.source, shown.configuration))?.document;
      if (circle) texts.set(annotation.id, holeCallout(component?.kind === 'component' ? configured(component, shown?.configuration) : undefined, this.projectParameters, circle.name, circle.radius, this.deps.parameters));
    }
    return texts;
  }

  /** The parts list of each view of an assembly: its components (and configurations) and how many of each, copies included. */
  private async partsLists(): Promise<Map<string, PartsList>> {
    const lists = new Map<string, PartsList>();
    for (const view of this.document.views) {
      const assembly = this.sources.get(sourceKey(view.source, view.configuration))?.document;
      if (assembly?.kind !== 'assembly') continue;
      lists.set(view.id, await this.partsList(assembly));
    }
    return lists;
  }

  private async partsList(assembly: AssemblyDocument): Promise<PartsList> {
    const rows: { item: number; name: string; count: number; material: string; key: string }[] = [];
    const items = new Map<string, number>();
    for (const instance of assembly.instances) {
      const key = sourceKey(instance.component, instance.configuration);
      let row = rows.find((r) => r.key === key);
      if (!row) {
        const component = await this.deps.documents.load(instance.component);
        const configuration = component?.kind === 'component' && instance.configuration ? component.configurations?.find((c) => c.id === instance.configuration)?.name : undefined;
        const name = `${component?.name ?? 'Missing component'}${configuration ? ` (${configuration})` : ''}`;
        const material = component?.kind === 'component' ? materialNames(component) : '';
        row = { item: rows.length + 1, name, count: 0, material, key };
        rows.push(row);
      }
      row.count++;
      items.set(instance.id, row.item);
    }
    // Copies of patterns count as their originals, and carry their item numbers.
    for (const pattern of assembly.patterns ?? []) {
      const copies = pattern.kind === 'mirror' ? 1 : Math.max(0, Math.round(pattern.count) - 1);
      for (const instance of pattern.instances) {
        const item = items.get(instance);
        const row = rows.find((r) => r.item === item);
        if (!row || item === undefined) continue;
        row.count += copies;
        for (let k = 1; k <= copies; k++) items.set(`${pattern.id}/${instance}/${k}`, item);
      }
    }
    return { rows: rows.map(({ key: _key, ...row }) => row), items };
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/** What a drawn view shows: its source's result, direction, hidden lines and section. */
function viewKey(view: DrawingView, stamp: string): string {
  const { section } = view;
  const cut = section ? `${section.offset}${section.steps?.length ? `;${section.along ?? 'u'}${section.steps.map((s) => `,${s.at}:${s.offset}`).join('')}` : ''}${section.half ? ';half' : ''}` : '';
  return `${sourceKey(view.source, view.configuration)}:${stamp}|${view.direction}|${view.hidden}|${cut}${view.hide?.length ? `|hide:${[...view.hide].sort().join(',')}` : ''}`;
}

/** The bodies a view shows (CAD-193): those it does not leave out, an assembly's by instance (`<instance>` or `<instance>#k`). */
function shownBy(view: DrawingView, bodies: readonly BodyState[]): BodyState[] {
  if (!view.hide?.length) return [...bodies];
  const hidden = new Set(view.hide);
  return bodies.filter((b) => !hidden.has(b.id) && !hidden.has(b.id.split('#')[0] as string));
}

/** The component with a configuration's parameter values, for texts computed from its features (callouts). */
function configured(component: ComponentDocument, configuration: string | undefined): ComponentDocument {
  const values = component.configurations?.find((c) => c.id === configuration)?.values;
  return values ? { ...component, parameters: component.parameters.map((p) => (p.name in values ? { ...p, expression: values[p.name] as string } : p)) } : component;
}

export class DefaultDrawingManager implements DrawingManager {
  private readonly exact: ExactViews;

  constructor(private readonly deps: DrawingManagerDependencies) {
    this.exact = new ExactViews(deps.exact);
  }

  async open(documentId: DocumentId): Promise<Result<DrawingSession>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'drawing') return fail({ code: 'unknown-document', message: `Drawing ${documentId} does not exist.` });
    const session = new Session(this.deps, document, this.exact);

    await session.start();
    return ok(session);
  }
}
