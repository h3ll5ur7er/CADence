import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import type { ProjectAccess } from '@core/access/project';
import {
  type AssemblyDocument,
  type BodyState,
  type CadDocument,
  type DocumentId,
  type DomainEvents,
  type DrawingDocument,
  type DrawingView,
  fail,
  type Material,
  materials,
  ok,
  type Parameter,
  type Result,
  resultStamp,
  sourceKey,
  type Vec2,
  type Vec3,
  type ViewDirection,
} from '@core/contracts';
import type { ModelingEngine, ViewGeometry } from '@core/engines/modeling';
import type { ParameterEngine } from '@core/engines/parameter';
import type { Clock } from '@core/utilities/clock';
import type { EventBus } from '@core/utilities/messaging';
import { encodePng } from '@core/utilities/picture';
import type { TextFont, TextWeight } from '@core/utilities/text';
import { holeCallout } from './callouts';
import { applyCommand } from './commands';
import type { DrawingCommand, DrawingManager, DrawingSession, DrawingState, SheetLayout } from './drawing-manager';
import { sheetDxf, sheetPdf, sheetPixels } from './exports';
import { layoutSheet, type PartsList } from './layout';

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
}

/** A view's right and up: the viewer is on the side of right × up (third-angle names). */
const s2 = Math.SQRT1_2;
const s6 = 1 / Math.sqrt(6);
const directions: Readonly<Record<ViewDirection, { readonly u: Vec3; readonly v: Vec3 }>> = {
  front: { u: [1, 0, 0], v: [0, 0, 1] },
  back: { u: [-1, 0, 0], v: [0, 0, 1] },
  top: { u: [1, 0, 0], v: [0, 1, 0] },
  bottom: { u: [1, 0, 0], v: [0, -1, 0] },
  right: { u: [0, 1, 0], v: [0, 0, 1] },
  left: { u: [0, -1, 0], v: [0, 0, 1] },
  iso: { u: [s2, s2, 0], v: [-s6, s6, 2 * s6] },
};

interface Source {
  readonly status: 'loading' | 'ready' | 'missing';
  readonly message?: string;
  readonly bodies: readonly BodyState[];
  readonly stamp: string;
  readonly document?: CadDocument;
}

const historyLimit = 200;
const maxRequests = 3;
const defaultMaterial = materials[0] as Material;

class Session implements DrawingSession {
  private layout: SheetLayout;
  private readonly sources = new Map<DocumentId, Source>();
  private readonly geometry = new Map<string, ViewGeometry | { readonly error: string }>();
  private readonly requests = new Map<DocumentId, number>();
  private readonly undoStack: DrawingDocument[] = [];
  private readonly redoStack: DrawingDocument[] = [];
  private readonly listeners = new Set<(state: DrawingState) => void>();
  private readonly unsubscribe: (() => void)[];
  private queue: Promise<unknown> = Promise.resolve();
  private projectParameters: readonly Parameter[] = [];

  constructor(
    private readonly deps: DrawingManagerDependencies,
    private document: DrawingDocument,
  ) {
    this.layout = layoutSheet({ document, geometry: new Map(), callouts: new Map(), parts: new Map() });
    const { events } = deps;
    const reload = (id: DocumentId, reason: 'regenerated' | 'failed' | 'changed') =>
      this.sources.has(id) || this.partsOf(id) ? this.serialized(() => this.refresh(id, reason)) : undefined;
    this.unsubscribe = [
      events.subscribe('componentRegenerated', ({ documentId, configuration, ok: done }) => (configuration ? undefined : reload(documentId, done ? 'regenerated' : 'failed'))),
      events.subscribe('resultPublished', ({ documentId, configuration }) => (configuration ? undefined : reload(documentId, 'changed'))),
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

  async start(): Promise<void> {
    this.projectParameters = (await this.deps.projects.find(this.document.projectId))?.parameters ?? [];
    for (const id of new Set(this.document.views.map((v) => v.source))) await this.load(id, 'open');
    await this.relayout();
  }

  state(): DrawingState {
    return { document: this.document, layout: this.layout, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
  }

  subscribe(listener: (state: DrawingState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    for (const source of this.sources.values()) void this.deps.modeling.keep(source.bodies, false);
    for (const stop of this.unsubscribe) stop();
    this.listeners.clear();
  }

  /** Puts a loaded source in place of the one before, holding its shapes in the shape store while views show it (CAD-121). */
  private hold(id: DocumentId, next: Source): void {
    const before = this.sources.get(id)?.bodies ?? [];
    this.sources.set(id, next);
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
      for (const [id, source] of [...this.sources]) {
        if (source.status !== 'ready') continue;
        // Changed since it was read (an assembly's result can lag behind its document: not the stamp).
        const document = await this.deps.documents.load(id);
        if (document?.modifiedAt === source.document?.modifiedAt) continue;
        await this.load(id, 'changed');
        changed = true;
      }
      if (changed) await this.relayout();
    });
  }

  private async apply(command: DrawingCommand): Promise<Result<void>> {
    if (command.type === 'add-view' || command.type === 'edit-view') {
      const source = await this.deps.documents.load(command.view.source);
      if (!command.view.detail && (!source || source.projectId !== this.document.projectId || (source.kind !== 'component' && source.kind !== 'assembly'))) {
        return fail({ code: 'invalid-command', message: 'A view shows a component or an assembly of this project.' });
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
    for (const id of new Set(document.views.map((v) => v.source))) if (!this.sources.has(id)) await this.load(id, 'open');
    await this.deps.documents.store(document);
    this.deps.events.publish('documentSaved', { projectId: document.projectId, documentId: document.id });
    await this.relayout();
  }

  private async refresh(id: DocumentId, reason: 'regenerated' | 'failed' | 'changed'): Promise<void> {
    if (this.sources.has(id)) await this.load(id, reason);
    else {
      // A component of a shown assembly: its name or material in the parts list.
      for (const [source, loaded] of this.sources) if (loaded.document?.kind === 'assembly') await this.load(source, 'changed');
    }
    await this.relayout();
  }

  /**
   * Reads a view's source from its published result: a component's (asked for again when stale,
   * like the Assembly Manager does) or an assembly's (published by its editor).
   */
  private async load(id: DocumentId, reason: 'open' | 'regenerated' | 'failed' | 'changed'): Promise<void> {
    const document = await this.deps.documents.load(id);
    const previous = this.sources.get(id);
    const missing = (message: string) => this.hold(id, { status: 'missing', message, bodies: [], stamp: '', ...(document ? { document } : {}) });
    if (!document || (document.kind !== 'component' && document.kind !== 'assembly')) return void missing('The document of this view is gone.');
    if (reason === 'failed') return void missing(`${document.name} cannot be built.`);
    const result = await this.deps.assets.latestResult(id);
    if (document.kind === 'assembly') {
      if (!result) return void missing(`Open ${document.name} once, so its parts are placed for drawings.`);
    } else if (result?.stamp !== resultStamp(document.modifiedAt, this.projectParameters)) {
      const requests = this.requests.get(id) ?? 0;
      if (reason === 'regenerated' && requests >= maxRequests) return void missing(`${document.name} cannot be built.`);
      this.requests.set(id, requests + 1);
      this.hold(id, { status: 'loading', bodies: previous?.bodies ?? [], stamp: previous?.stamp ?? '', document });
      this.deps.events.publish('regenerateComponent', { documentId: id });
      return;
    }
    if (!result) return void missing(`${document.name} has no result yet.`);
    this.requests.delete(id);
    const bodies = previous?.stamp === result.stamp && previous.status === 'ready' ? previous.bodies : await this.deps.modeling.restore(result.bytes, `result:${sourceKey(id)}:${result.stamp}`);
    this.hold(id, { status: 'ready', bodies, stamp: result.stamp, document });
  }

  /** Draws every view (from cache where nothing changed) and lays out the sheet. */
  private async relayout(): Promise<void> {
    const geometry = new Map<string, ViewGeometry | { readonly error: string }>();
    for (const view of this.document.views.filter((v) => !v.detail)) {
      const source = this.sources.get(view.source);
      if (!source || source.status !== 'ready') {
        geometry.set(view.id, { error: source?.status === 'missing' ? (source.message ?? 'Missing.') : 'Loading…' });
        continue;
      }
      geometry.set(view.id, await this.draw(view, source));
    }
    this.layout = layoutSheet({ document: this.document, geometry, callouts: this.callouts(geometry), parts: await this.partsLists() });
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  private async draw(view: DrawingView, source: Source): Promise<ViewGeometry | { readonly error: string }> {
    const key = `${view.source}:${source.stamp}|${view.direction}|${view.hidden}|${view.section?.offset ?? ''}`;
    const cached = this.geometry.get(key);
    if (cached) return cached;
    const { u, v } = directions[view.direction];
    const drawn = await this.deps.modeling.drawView(source.bodies, { frame: { origin: [0, 0, 0], u, v }, hidden: view.hidden, ...(view.section ? { cut: { offset: view.section.offset } } : {}) });
    const geometry = drawn.ok ? drawn.value : { error: drawn.error.message };
    this.geometry.set(key, geometry);
    return geometry;
  }

  /** The text of each hole callout, from the hole feature of the circle it points at. */
  private callouts(geometry: ReadonlyMap<string, ViewGeometry | { readonly error: string }>): Map<string, readonly string[]> {
    const texts = new Map<string, readonly string[]>();
    for (const annotation of this.document.annotations) {
      if (annotation.kind !== 'callout') continue;
      const view = this.document.views.find((v) => v.id === annotation.circle.view);
      const drawn = view && geometry.get(view.detail?.of ?? view.id);
      const circle = drawn && !('error' in drawn) ? drawn.circles.find((c) => c.name === annotation.circle.name) : undefined;
      const component = view && this.sources.get(view.source)?.document;
      if (circle) texts.set(annotation.id, holeCallout(component?.kind === 'component' ? component : undefined, this.projectParameters, circle.name, circle.radius, this.deps.parameters));
    }
    return texts;
  }

  /** The parts list of each view of an assembly: its components (and configurations) and how many of each, copies included. */
  private async partsLists(): Promise<Map<string, PartsList>> {
    const lists = new Map<string, PartsList>();
    for (const view of this.document.views) {
      const assembly = this.sources.get(view.source)?.document;
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
        const material = component?.kind === 'component' ? (component.material ?? defaultMaterial).name : '';
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

export class DefaultDrawingManager implements DrawingManager {
  constructor(private readonly deps: DrawingManagerDependencies) {}

  async open(documentId: DocumentId): Promise<Result<DrawingSession>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'drawing') return fail({ code: 'unknown-document', message: `Drawing ${documentId} does not exist.` });
    const session = new Session(this.deps, document);
    await session.start();
    return ok(session);
  }
}
