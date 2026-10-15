import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import {
  type AssemblyDocument,
  type BodyState,
  type CadDocument,
  type DocumentId,
  type DomainEvents,
  fail,
  type Interference,
  type JointOrigin,
  type Matrix4,
  type MotionFrame,
  ok,
  type PlaneFrame,
  type Result,
} from '@core/contracts';
import type { AnalysisEngine } from '@core/engines/analysis';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { KinematicJoint, KinematicModel, KinematicsEngine } from '@core/engines/kinematics';
import type { ModelingEngine } from '@core/engines/modeling';
import type { Clock } from '@core/utilities/clock';
import type { EventBus } from '@core/utilities/messaging';
import type { AssemblyCommand, AssemblyFormat, AssemblyManager, AssemblySession, AssemblyState, ComponentView } from './assembly-manager';
import { applyCommand } from './commands';

export interface AssemblyManagerDependencies {
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly modeling: ModelingEngine;
  readonly kinematics: KinematicsEngine;
  readonly analysis: AnalysisEngine;
  readonly interchange: InterchangeEngine;
  readonly events: EventBus<DomainEvents>;
  readonly clock: Clock;
}

interface LoadedComponent {
  readonly view: ComponentView;
  readonly bodies: readonly BodyState[];
  /** The component's `modifiedAt` the bodies were made from. */
  readonly stamp: string;
}

interface Derived {
  readonly poses: ReadonlyMap<string, Matrix4>;
  readonly placed: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, readonly number[]>;
  readonly errors: ReadonlyMap<string, string>;
}

const historyLimit = 200;
const maxRequests = 3;
const componentOrigin: PlaneFrame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] };
const solidTypes: Readonly<Record<AssemblyFormat, string>> = { step: 'model/step', stl: 'model/stl', obj: 'model/obj', '3mf': 'model/3mf' };

class Session implements AssemblySession {
  private derived: Derived = { poses: new Map(), placed: new Set(), values: new Map(), errors: new Map() };
  private readonly components = new Map<DocumentId, LoadedComponent>();
  private readonly frames = new Map<string, Result<PlaneFrame>>();
  /** Regeneration requests per component; a component edited again meanwhile is asked for again, a few times. */
  private readonly requests = new Map<DocumentId, number>();
  private readonly undoStack: AssemblyDocument[] = [];
  private readonly redoStack: AssemblyDocument[] = [];
  private readonly listeners = new Set<(state: AssemblyState) => void>();
  private readonly unsubscribe: (() => void)[];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: AssemblyManagerDependencies,
    private document: AssemblyDocument,
  ) {
    const { events } = deps;
    const uses = (id: DocumentId) => this.components.has(id);
    this.unsubscribe = [
      events.subscribe('componentRegenerated', ({ documentId, ok: done }) =>
        uses(documentId) ? this.serialized(() => this.refresh(documentId, done ? 'regenerated' : 'failed')) : undefined,
      ),
      events.subscribe('documentRenamed', ({ documentId }) => (uses(documentId) ? this.serialized(() => this.refresh(documentId, 'changed')) : undefined)),
      events.subscribe('documentDeleted', ({ documentId }) => (uses(documentId) ? this.serialized(() => this.refresh(documentId, 'changed')) : undefined)),
    ];
  }

  async start(): Promise<void> {
    for (const id of new Set(this.document.instances.map((i) => i.component))) await this.load(id, 'open');
    this.derived = await this.derive(this.document);
  }

  state(): AssemblyState {
    return {
      document: this.document,
      components: new Map([...this.components].map(([id, c]) => [id, c.view])),
      poses: this.derived.poses,
      placed: this.derived.placed,
      jointErrors: this.derived.errors,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  subscribe(listener: (state: AssemblyState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    for (const stop of this.unsubscribe) stop();
    this.listeners.clear();
  }

  execute(command: AssemblyCommand): Promise<Result<void>> {
    return this.serialized(() => this.apply(command));
  }

  undo(): Promise<void> {
    return this.serialized(() => this.travel(this.undoStack, this.redoStack));
  }

  redo(): Promise<void> {
    return this.serialized(() => this.travel(this.redoStack, this.undoStack));
  }

  async previewJoint(jointId: string, values: readonly number[]): Promise<Result<ReadonlyMap<string, Matrix4>>> {
    const document = { ...this.document, joints: this.document.joints.map((j) => (j.id === jointId ? { ...j, values } : j)) };
    const derived = await this.derive(document, new Set([jointId]));
    const error = derived.errors.get(jointId);
    return error ? fail({ code: 'joint-failed', message: error }) : ok(derived.poses);
  }

  async motion(studyId: string, fps: number): Promise<Result<readonly MotionFrame[]>> {
    const study = this.document.motionStudies.find((s) => s.id === studyId);
    if (!study) return fail({ code: 'invalid-command', message: `Study ${studyId} does not exist.` });
    const { model } = await this.model(this.document);
    const { frames, error } = this.deps.kinematics.simulate(model, study, fps);
    if (error) return fail({ code: 'motion-failed', message: `At ${error.time.toFixed(2)} s, ${this.jointName(error.joint)}: ${error.message}` });
    return ok(frames);
  }

  interference(): Promise<Interference[]> {
    return this.deps.analysis.interference(
      this.readyInstances().map(({ instance, component, transform }) => ({ instance: instance.id, bodies: component.bodies, transform })),
    );
  }

  async exportAssembly(format: AssemblyFormat): Promise<Result<void>> {
    const bodies = this.readyInstances().flatMap(({ instance, component, transform }) =>
      component.bodies.map((body, k) => ({ name: component.bodies.length > 1 ? `${instance.name} (${k + 1})` : instance.name, key: body.key, transform })),
    );
    if (bodies.length === 0) return fail({ code: 'nothing-to-export', message: 'Insert components with bodies first.' });
    try {
      const bytes = await this.deps.interchange.exportBodies(bodies, format);
      await this.deps.externalFiles.deliver({ name: `${this.document.name}.${format}`, mediaType: solidTypes[format], bytes });
      return ok(undefined);
    } catch (error) {
      return fail({ code: 'export-failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async saveRecording(bytes: Uint8Array, studyName: string): Promise<void> {
    await this.deps.externalFiles.deliver({ name: `${this.document.name} - ${studyName}.webm`, mediaType: 'video/webm', bytes });
  }

  private async apply(command: AssemblyCommand): Promise<Result<void>> {
    let componentName: string | undefined;
    if (command.type === 'insert-instance') {
      const component = await this.deps.documents.load(command.instance.component);
      const solid = component?.kind === 'component' || (component?.kind === 'imported' && component.format !== 'dxf' && component.format !== 'svg');
      if (!component || !solid) return fail({ code: 'invalid-command', message: 'Only components and imported 3D files can be inserted into an assembly.' });
      componentName = component.name;
    }
    if (command.type === 'move-instance' && this.derived.placed.has(command.instanceId)) {
      return fail({ code: 'placed-by-joint', message: 'A joint places this instance; change the joint’s values to move it.' });
    }
    const applied = applyCommand(this.document, command, componentName);
    if (!applied.ok) return applied;
    for (const instance of applied.value.document.instances) if (!this.components.has(instance.component)) await this.load(instance.component, 'open');
    const target = applied.value.joint;
    const derived = await this.derive(applied.value.document, target ? new Set([target]) : undefined);
    const error = target && derived.errors.get(target);
    if (error) return fail({ code: 'joint-failed', message: error });
    // Loops and limits may have moved the other joints: the document keeps what was solved.
    const joints = applied.value.document.joints.map((j) => ({ ...j, values: derived.values.get(j.id) ?? j.values }));
    this.undoStack.push(this.document);
    if (this.undoStack.length > historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    await this.commit({ ...applied.value.document, joints, modifiedAt: this.deps.clock().toISOString() }, derived);
    return ok(undefined);
  }

  private async travel(from: AssemblyDocument[], to: AssemblyDocument[]): Promise<void> {
    const target = from.pop();
    if (!target) return;
    to.push(this.document);
    await this.commit(target, await this.derive(target));
  }

  private async commit(document: AssemblyDocument, derived: Derived): Promise<void> {
    this.document = document;
    this.derived = derived;
    await this.deps.documents.store(document);
    this.notify();
  }

  private notify(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  /** Re-reads a component after the Design Manager answered, or after it was renamed or deleted. */
  private async refresh(id: DocumentId, reason: 'regenerated' | 'failed' | 'changed'): Promise<void> {
    await this.load(id, reason);
    this.derived = await this.derive(this.document);
    this.notify();
  }

  /**
   * Restores a component from its published result. A missing or stale result is requested from the
   * Design Manager (queued); the answer arrives as `componentRegenerated` (docs/Architecture/Decisions.md#adr-11).
   */
  private async load(id: DocumentId, reason: 'open' | 'regenerated' | 'failed' | 'changed'): Promise<void> {
    const document = await this.deps.documents.load(id);
    const previous = this.components.get(id);
    if (document?.kind === 'imported') {
      await this.loadImported(document);
      return;
    }
    if (document?.kind !== 'component' || reason === 'failed') {
      this.components.set(id, { view: { id, name: document?.name ?? previous?.view.name ?? 'Missing component', status: 'missing', bodies: [] }, bodies: [], stamp: '' });
      return;
    }
    const result = await this.deps.assets.latestResult(id);
    if (result?.stamp !== document.modifiedAt) {
      const requests = this.requests.get(id) ?? 0;
      if (reason === 'regenerated' && requests >= maxRequests) {
        this.components.set(id, { view: { id, name: document.name, status: 'missing', bodies: [] }, bodies: [], stamp: '' });
        return;
      }
      this.requests.set(id, requests + 1);
      this.components.set(id, { view: { id, name: document.name, status: 'loading', bodies: previous?.view.bodies ?? [] }, bodies: previous?.bodies ?? [], stamp: previous?.stamp ?? '' });
      this.deps.events.publish('regenerateComponent', { documentId: id });
      return;
    }
    this.requests.delete(id);
    const appearances = document.appearances ?? {};
    if (previous?.stamp === result.stamp && previous.view.status === 'ready') {
      this.components.set(id, { ...previous, view: { ...previous.view, name: document.name, appearances } });
      return;
    }
    const bodies = await this.deps.modeling.restore(result.bytes, `result:${id}:${result.stamp}`);
    const meshes = bodies.length ? await this.deps.modeling.tessellate(bodies) : [];
    this.components.set(id, { view: { id, name: document.name, status: 'ready', bodies: meshes, appearances }, bodies, stamp: result.stamp });
  }

  /**
   * An imported 3D file used like a component: its solids are read (once per original) and named
   * like an inserted body, so joints can attach to its faces and edges.
   */
  private async loadImported(document: Extract<CadDocument, { kind: 'imported' }>): Promise<void> {
    const { id, name, assetId, format } = document;
    const missing = () => {
      this.components.set(id, { view: { id, name, status: 'missing', bodies: [] }, bodies: [], stamp: '' });
    };
    if (this.components.get(id)?.stamp === assetId) return;
    const original = format === 'dxf' || format === 'svg' ? undefined : await this.deps.assets.fetch(assetId);
    if (!original || format === 'dxf' || format === 'svg') return missing();
    const sources = await this.deps.interchange.readSolids(original.bytes, format, `import:${assetId}`);
    if (!sources.ok) return missing();
    const outcome = await this.deps.modeling.apply({ type: 'insert', feature: 'import', key: `imported:${assetId}`, bodies: [], sources: sources.value });
    if (outcome.error) return missing();
    const meshes = await this.deps.modeling.tessellate(outcome.bodies);
    this.components.set(id, { view: { id, name, status: 'ready', bodies: meshes }, bodies: outcome.bodies, stamp: assetId });
  }

  /** The kinematic model: joints whose frames resolve, and the reasons of those that do not. */
  private async model(document: AssemblyDocument): Promise<{ model: KinematicModel; errors: Map<string, string> }> {
    const errors = new Map<string, string>();
    const joints: KinematicJoint[] = [];
    for (const joint of document.joints) {
      const [a, b] = [await this.frame(document, joint.a), await this.frame(document, joint.b)];
      if (!a.ok || !b.ok) {
        errors.set(joint.id, (!a.ok ? a.error : (b as { error: { message: string } }).error).message);
        continue;
      }
      joints.push({ ...joint, a: { instance: joint.a.instance, frame: a.value }, b: { instance: joint.b.instance, frame: b.value } });
    }
    const instances = document.instances.map((i) => ({ id: i.id, transform: i.transform, grounded: i.grounded }));
    return { model: { instances, joints }, errors };
  }

  private async derive(document: AssemblyDocument, driven?: ReadonlySet<string>): Promise<Derived> {
    const { model, errors } = await this.model(document);
    const solution = this.deps.kinematics.solve(model, driven);
    if (solution.error) errors.set(solution.error.joint, solution.error.message);
    return { poses: solution.poses, placed: solution.placed, values: solution.values, errors };
  }

  /** A joint origin's frame in its component's coordinates, cached per component version. */
  private async frame(document: AssemblyDocument, origin: JointOrigin): Promise<Result<PlaneFrame>> {
    if (!origin.ref) return ok(componentOrigin);
    const instance = document.instances.find((i) => i.id === origin.instance);
    const component = instance && this.components.get(instance.component);
    if (!component || component.view.status !== 'ready') {
      return fail({ code: 'not-ready', message: `${component?.view.name ?? 'The component'} is ${component?.view.status === 'missing' ? 'missing' : 'still loading'}.` });
    }
    const key = `${component.stamp}|${JSON.stringify(origin.ref)}`;
    const cached = this.frames.get(key);
    if (cached) return cached;
    const frame = await this.deps.modeling.frameOf(component.bodies, origin.ref);
    this.frames.set(key, frame);
    return frame;
  }

  private readyInstances() {
    return this.document.instances.flatMap((instance) => {
      const component = this.components.get(instance.component);
      const transform = this.derived.poses.get(instance.id);
      return component?.view.status === 'ready' && transform ? [{ instance, component, transform }] : [];
    });
  }

  private jointName(id: string): string {
    return this.document.joints.find((j) => j.id === id)?.name ?? id;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export class DefaultAssemblyManager implements AssemblyManager {
  constructor(private readonly deps: AssemblyManagerDependencies) {}

  async open(documentId: DocumentId): Promise<Result<AssemblySession>> {
    const document = await this.deps.documents.load(documentId);
    if (document?.kind !== 'assembly') return fail({ code: 'unknown-document', message: `Assembly ${documentId} does not exist.` });
    const session = new Session(this.deps, document);
    await session.start();
    return ok(session);
  }
}
