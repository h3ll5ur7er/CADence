import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import {
  type BodyMesh,
  type BodyProperties,
  type ComponentDocument,
  type DocumentId,
  fail,
  isSketch,
  manufacturingProfiles,
  type ManufacturingProfile,
  type Material,
  materials,
  type Measurement,
  ok,
  type Result,
  type TopologyRef,
  type ValidationReport,
} from '@core/contracts';
import type { AnalysisEngine } from '@core/engines/analysis';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { ModelingEngine } from '@core/engines/modeling';
import type { ParameterEngine } from '@core/engines/parameter';
import type { SketchEngine } from '@core/engines/sketch';
import type { Clock } from '@core/utilities/clock';
import { applyCommand } from './commands';
import type {
  DesignCommand,
  DesignManager,
  DesignSession,
  DesignState,
  DrawingFormat,
  SketchView,
  SolidFormat,
} from './design-manager';
import { type Derived, Regeneration } from './regeneration';

export interface DesignManagerDependencies {
  readonly documents: DocumentAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly sketches: SketchEngine;
  readonly parameters: ParameterEngine;
  readonly modeling: ModelingEngine;
  readonly interchange: InterchangeEngine;
  readonly analysis: AnalysisEngine;
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

  constructor(
    private readonly deps: DesignManagerDependencies,
    initial: Snapshot,
  ) {
    this.current = initial;
    for (const mesh of initial.meshes) this.meshCache.set(mesh.key, mesh);
  }

  state(): DesignState {
    const { document, derived, meshes } = this.current;
    return {
      document,
      sketches: derived.sketches,
      items: derived.items,
      planes: derived.planes,
      bodies: meshes,
      parameters: derived.parameters,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  subscribe(listener: (state: DesignState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

  async previewDrag(sketchId: string, pointId: string, x: number, y: number): Promise<SketchView | undefined> {
    const view = this.current.derived.sketches.get(sketchId);
    if (!view || view.error) return undefined;
    const solution = await this.deps.sketches.solve(view.sketch, view.values, { point: pointId, x, y });
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
      const bytes = await this.deps.interchange.exportDrawing(view.sketch, format, kerf);
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

  async exportBodies(format: SolidFormat): Promise<Result<void>> {
    const { document, derived } = this.current;
    if (derived.bodies.length === 0) return fail({ code: 'nothing-to-export', message: 'There are no bodies to export yet.' });
    try {
      const bytes = await this.deps.interchange.exportBodies(this.namedBodies(), format);
      await this.deps.externalFiles.deliver({ name: `${document.name}.${format}`, mediaType: solidTypes[format], bytes });
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

  /** Bodies with the names of the features that made them. */
  private namedBodies() {
    const { document, derived } = this.current;
    return derived.bodies.map((b) => ({ ...b, name: document.timeline.find((item) => item.id === b.id)?.name ?? b.id }));
  }

  private async apply(command: DesignCommand): Promise<Result<void>> {
    const applied = applyCommand(this.current.document, command);
    if (!applied.ok) return applied;
    const { document, target, drag } = applied.value;
    const derived = await new Regeneration(this.deps, drag).run(document);
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
    if (status?.state === 'error') return fail({ code: errorCode(status.error), message: status.error ?? 'This change fails.' });
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
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

const materialOf = (document: ComponentDocument): Material => document.material ?? (materials[0] as Material);
const processOf = (document: ComponentDocument): ManufacturingProfile => document.process ?? (manufacturingProfiles[0] as ManufacturingProfile);

/** Stable error codes for the kinds of failure the messages describe. */
function errorCode(message: string | undefined): string {
  if (!message) return 'failed';
  if (message.includes('conflicts with existing constraints')) return 'over-constrained';
  if (message.includes('shrink a line')) return 'degenerate';
  if (message.includes('": ')) return 'invalid-expression';
  return 'feature-failed';
}

export class DefaultDesignManager implements DesignManager {
  constructor(private readonly deps: DesignManagerDependencies) {}

  async open(documentId: DocumentId): Promise<Result<DesignSession>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'component') {
      return fail({ code: 'unknown-document', message: `Component ${documentId} does not exist.` });
    }
    const derived = await new Regeneration(this.deps).run(document);
    const meshes = derived.bodies.length ? await this.deps.modeling.tessellate(derived.bodies) : [];
    return ok(new Session(this.deps, { document, derived, meshes }));
  }
}
