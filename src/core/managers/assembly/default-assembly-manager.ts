import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ProjectAccess } from '@core/access/project';
import type { ExternalFileAccess } from '@core/access/external-file';
import {
  type AssemblyDocument,
  type BodyMesh,
  type BodyState,
  type CadDocument,
  type DocumentId,
  type DomainEvents,
  fail,
  type Interference,
  isModelFormat,
  type JointOrigin,
  type Material,
  materials,
  type Matrix4,
  type Measurement,
  type MotionFrame,
  offsetFrame,
  ok,
  type PlaneFrame,
  type Result,
  resultStamp,
  sourceKey,
  type Vec3,
} from '@core/contracts';
import type { AnalysisEngine } from '@core/engines/analysis';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { KinematicJoint, KinematicModel, KinematicsEngine } from '@core/engines/kinematics';
import type { ModelingEngine } from '@core/engines/modeling';
import type { Clock } from '@core/utilities/clock';
import { compose, fromFrame, transformPoint, translation } from '@core/utilities/math';
import { toCsv } from '@core/utilities/csv';
import type { EventBus } from '@core/utilities/messaging';
import type { AssemblyCommand, AssemblyFormat, AssemblyManager, AssemblyProperties, AssemblySession, AssemblyState, BomLine, Collision, ComponentView, InstructionPicture, PlacedRef } from './assembly-manager';
import { applyCommand } from './commands';
import { copyId, patternTransforms } from './patterns';
import { viewerHtml } from '@core/utilities/viewer';

export interface AssemblyManagerDependencies {
  /** Project parameters are part of what a component result was made from. */
  readonly projects: ProjectAccess;
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
  /** What its parts weigh by. */
  readonly material: Material;
}

interface Derived {
  readonly poses: ReadonlyMap<string, Matrix4>;
  readonly placed: ReadonlySet<string>;
  readonly values: ReadonlyMap<string, readonly number[]>;
  readonly errors: ReadonlyMap<string, string>;
  readonly copies: ReadonlyMap<string, { readonly instance: string; readonly pattern: string }>;
  readonly jointFrames: ReadonlyMap<string, PlaneFrame>;
}

const defaultMaterial = materials[0] as Material;
const frameMatrix = (f: PlaneFrame): Matrix4 => {
  const [u, v] = [f.u, f.v];
  return fromFrame(f.origin, u, v, [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
};

const historyLimit = 200;
const maxRequests = 3;
const componentOrigin: PlaneFrame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0] };
const solidTypes: Readonly<Record<AssemblyFormat, string>> = { step: 'model/step', stl: 'model/stl', obj: 'model/obj', '3mf': 'model/3mf' };

class Session implements AssemblySession {
  private derived: Derived = { poses: new Map(), placed: new Set(), values: new Map(), errors: new Map(), copies: new Map(), jointFrames: new Map() };
  /** By source: a component, or a configuration of it (`sourceKey`). */
  private readonly components = new Map<string, LoadedComponent>();
  private readonly frames = new Map<string, Result<PlaneFrame>>();
  /** Regeneration requests per source; a component edited again meanwhile is asked for again, a few times. */
  private readonly requests = new Map<string, number>();
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
    // The sources (component and configuration) of a component that this assembly shows.
    const sourcesOf = (id: DocumentId) => [...this.components.keys()].filter((source) => source === id || source.startsWith(`${id}@`));
    const refreshAll = (sources: readonly string[]) =>
      sources.length
        ? this.serialized(async () => {
            for (const source of sources) await this.refresh(source, 'changed');
          })
        : undefined;
    this.unsubscribe = [
      events.subscribe('componentRegenerated', ({ documentId, configuration, ok: done }) => {
        const source = sourceKey(documentId, configuration);
        return this.components.has(source) ? this.serialized(() => this.refresh(source, done ? 'regenerated' : 'failed')) : undefined;
      }),
      events.subscribe('documentRenamed', ({ documentId }) => refreshAll(sourcesOf(documentId))),
      // A component edited elsewhere (another tab or window: CAD-82): its result is read again, or asked for.
      events.subscribe('documentChanged', ({ documentId }) => refreshAll(sourcesOf(documentId))),
      events.subscribe('documentRestored', ({ documentId }) => refreshAll(sourcesOf(documentId))),
      events.subscribe('documentDeleted', ({ documentId }) => refreshAll(sourcesOf(documentId))),
      // New project parameters make the project's component results stale.
      events.subscribe('projectParametersChanged', ({ projectId }) => (projectId === this.document.projectId ? refreshAll([...this.components.keys()]) : undefined)),
    ];
  }

  async start(): Promise<void> {
    for (const source of new Set(this.document.instances.map((i) => sourceKey(i.component, i.configuration)))) await this.load(source, 'open');
    this.derived = await this.derive(this.document);
  }

  state(): AssemblyState {
    return {
      document: this.document,
      components: new Map([...this.components].map(([id, c]) => [id, c.view])),
      poses: this.derived.poses,
      placed: this.derived.placed,
      jointErrors: this.derived.errors,
      copies: this.derived.copies,
      jointFrames: this.derived.jointFrames,
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

  async measure(refs: readonly PlacedRef[]): Promise<Result<Measurement>> {
    return this.deps.analysis.measurePlaced(this.placedParts(), refs);
  }

  async properties(): Promise<AssemblyProperties> {
    let [mass, volume] = [0, 0];
    const moment = [0, 0, 0];
    const parts: AssemblyProperties['parts'][number][] = [];
    for (const { instance, component, transform } of this.readyInstances()) {
      if (instance.appearance?.hidden) continue;
      const bodies = await this.deps.analysis.properties(component.bodies, component.material.density);
      const partMass = bodies.reduce((sum, b) => sum + b.mass, 0);
      for (const body of bodies) {
        const center = transformPoint(transform, body.centerOfMass);
        center.forEach((c, i) => (moment[i] = (moment[i] as number) + c * body.mass));
        volume += body.volume;
      }
      mass += partMass;
      parts.push({ instance: instance.id, name: instance.name, material: component.material.name, mass: partMass });
    }
    const centerOfMass: Vec3 = mass > 0 ? [(moment[0] as number) / mass, (moment[1] as number) / mass, (moment[2] as number) / mass] : [0, 0, 0];
    return { mass, volume, centerOfMass, parts };
  }

  async collisions(studyId: string, fps: number): Promise<Result<readonly Collision[]>> {
    const frames = await this.motion(studyId, fps);
    if (!frames.ok) return frames;
    const found = new Map<string, Collision>();
    const ready = this.readyInstances().filter(({ instance }) => !this.derived.copies.has(instance.id));
    for (const frame of frames.value) {
      const parts = ready.flatMap(({ instance, component }) => {
        const transform = frame.poses[instance.id];
        return transform ? [{ instance: instance.id, bodies: component.bodies, transform }] : [];
      });
      for (const hit of await this.deps.analysis.interference(parts)) {
        const key = `${hit.a}|${hit.b}`;
        if (!found.has(key)) found.set(key, { time: frame.time, a: hit.a, b: hit.b, volume: hit.volume });
      }
    }
    return ok([...found.values()].sort((x, y) => x.time - y.time));
  }

  explode(viewId: string, steps?: number, amount = 1): ReadonlyMap<string, Matrix4> {
    const view = this.document.explodedViews?.find((v) => v.id === viewId);
    const poses = new Map(this.derived.poses);
    if (!view) return poses;
    const count = Math.min(steps ?? view.steps.length, view.steps.length);
    view.steps.slice(0, count).forEach((step, i) => {
      const share = i === count - 1 ? Math.max(0, Math.min(1, amount)) : 1;
      const length = Math.hypot(...step.direction) || 1;
      const move = translation(step.direction.map((d) => (d / length) * step.distance * share) as [number, number, number]);
      for (const instance of step.instances) {
        const pose = poses.get(instance);
        if (pose) poses.set(instance, compose(move, pose));
      }
    });
    return poses;
  }

  async billOfMaterials(): Promise<readonly BomLine[]> {
    const lines = new Map<string, { line: Omit<BomLine, 'mass' | 'instances' | 'count'>; instances: string[]; mass: Promise<number> }>();
    for (const { instance, component } of this.readyInstances()) {
      const source = sourceKey(instance.component, instance.configuration);
      const entry = lines.get(source);
      if (entry) {
        entry.instances.push(instance.id);
        continue;
      }
      const configuration = instance.configuration ? component.view.configurations?.find((c) => c.id === instance.configuration)?.name : undefined;
      const name = this.components.get(source)?.view.name.replace(/ \(.*\)$/, '') ?? 'Component';
      const mass = this.deps.analysis.properties(component.bodies, component.material.density).then((bodies) => bodies.reduce((sum, b) => sum + b.mass, 0));
      lines.set(source, { line: { component: name, ...(configuration ? { configuration } : {}), material: component.material.name }, instances: [instance.id], mass });
    }
    const result: BomLine[] = [];
    for (const { line, instances, mass } of lines.values()) result.push({ ...line, count: instances.length, mass: await mass, instances });
    return result.sort((a, b) => a.component.localeCompare(b.component));
  }

  async exportBillOfMaterials(): Promise<Result<void>> {
    await this.loaded();
    const lines = await this.billOfMaterials();
    if (!lines.length) return fail({ code: 'nothing-to-export', message: 'Insert components first.' });
    const grams = (v: number) => (Math.round(v * 100) / 100).toString();
    const csv = toCsv([
      ['Component', 'Configuration', 'Count', 'Material', 'Mass each (g)', 'Mass (g)'],
      ...lines.map((l) => [l.component, l.configuration ?? '', String(l.count), l.material, grams(l.mass), grams(l.mass * l.count)]),
    ]);
    await this.deps.externalFiles.deliver({ name: `${this.document.name} bill of materials.csv`, mediaType: 'text/csv', bytes: new TextEncoder().encode(csv) });
    return ok(undefined);
  }

  async exportInstructions(viewId: string, pictures: readonly InstructionPicture[]): Promise<Result<void>> {
    const view = this.document.explodedViews?.find((v) => v.id === viewId);
    if (!view?.steps.length) return fail({ code: 'invalid-command', message: 'Make an exploded view with steps first.' });
    if (pictures.length !== view.steps.length + 1) return fail({ code: 'invalid-command', message: 'One picture is needed for the assembled state and one after each step.' });
    await this.loaded();
    const bom = await this.billOfMaterials();
    const names = new Map([...this.document.instances, ...this.readyInstances().map((r) => r.instance)].map((i) => [i.id, i.name]));
    // Loaded when needed: most sessions never make instructions.
    const { instructionsPdf } = await import('./instructions');
    const bytes = instructionsPdf({ title: this.document.name, view, bom, names, pictures });
    await this.deps.externalFiles.deliver({ name: `${this.document.name} - ${view.name}.pdf`, mediaType: 'application/pdf', bytes });
    return ok(undefined);
  }

  interference(): Promise<Interference[]> {
    return this.deps.analysis.interference(this.placedParts());
  }

  private placedParts() {
    return this.readyInstances().map(({ instance, component, transform }) => ({ instance: instance.id, bodies: component.bodies, transform }));
  }

  async exportAssembly(format: AssemblyFormat): Promise<Result<void>> {
    // Every part, also those still being regenerated.
    await this.loaded();
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

  async exportViewer(): Promise<Result<void>> {
    await this.loaded();
    const parts = this.readyInstances()
      .filter(({ instance }) => !instance.appearance?.hidden)
      .flatMap(({ instance, component, transform }) =>
        component.view.bodies.map((body, k) => {
          const look = instance.appearance ?? component.view.appearances?.[body.body];
          return {
            name: component.view.bodies.length > 1 ? `${instance.name} (${k + 1})` : instance.name,
            ...(look?.color ? { color: look.color } : {}),
            opacity: look?.opacity ?? 1,
            positions: body.positions,
            normals: body.normals,
            indices: body.indices,
            edges: body.edgePositions,
            transform,
          };
        }),
      );
    if (parts.length === 0) return fail({ code: 'nothing-to-export', message: 'Insert components with bodies first.' });
    const bytes = new TextEncoder().encode(viewerHtml({ title: this.document.name, parts }));
    await this.deps.externalFiles.deliver({ name: `${this.document.name}.html`, mediaType: 'text/html', bytes });
    return ok(undefined);
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
    for (const instance of applied.value.document.instances) {
      const source = sourceKey(instance.component, instance.configuration);
      if (!this.components.has(source)) await this.load(source, 'open');
    }
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
    this.deps.events.publish('documentSaved', { projectId: document.projectId, documentId: document.id });
    this.notify();
  }

  /** Resolves once no component the assembly shows is still loading (or after `timeout` ms). */
  private loaded(timeout = 120_000): Promise<void> {
    const loading = () => this.document.instances.some((i) => this.components.get(sourceKey(i.component, i.configuration))?.view.status === 'loading');
    if (!loading()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve();
      };
      const check = () => (loading() ? undefined : done());
      const timer = setTimeout(done, timeout);
      this.listeners.add(check);
    });
  }

  private notify(): void {
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  /** Re-reads a component after the Design Manager answered, or after it was renamed or deleted. */
  private async refresh(source: string, reason: 'regenerated' | 'failed' | 'changed'): Promise<void> {
    await this.load(source, reason);
    this.derived = await this.derive(this.document);
    this.notify();
  }

  /**
   * Restores a component from its published result. A missing or stale result is requested from the
   * Design Manager (queued); the answer arrives as `componentRegenerated` (docs/Architecture/Decisions.md#adr-11).
   */
  private async load(source: string, reason: 'open' | 'regenerated' | 'failed' | 'changed'): Promise<void> {
    const [id, configuration] = source.split('@') as [DocumentId, string | undefined];
    const document = await this.deps.documents.load(id);
    const previous = this.components.get(source);
    const view = (status: ComponentView['status'], bodies: readonly BodyMesh[], name = document?.name ?? previous?.view.name ?? 'Missing component'): ComponentView => ({
      id,
      ...(configuration ? { configuration } : {}),
      name: configuration && document?.kind === 'component' ? `${name} (${document.configurations?.find((c) => c.id === configuration)?.name ?? 'missing configuration'})` : name,
      status,
      bodies,
      ...(document?.kind === 'component' && document.configurations?.length ? { configurations: document.configurations.map(({ id: c, name: n }) => ({ id: c, name: n })) } : {}),
    });
    if (document?.kind === 'imported') {
      await this.loadImported(document);
      return;
    }
    if (document?.kind !== 'component' || reason === 'failed') {
      this.components.set(source, { view: view('missing', []), bodies: [], stamp: '', material: defaultMaterial });
      return;
    }
    const material = document.material ?? defaultMaterial;
    const result = await this.deps.assets.latestResult(id, configuration);
    const stamp = resultStamp(document.modifiedAt, (await this.deps.projects.find(document.projectId))?.parameters);
    if (result?.stamp !== stamp) {
      const requests = this.requests.get(source) ?? 0;
      if (reason === 'regenerated' && requests >= maxRequests) {
        this.components.set(source, { view: view('missing', []), bodies: [], stamp: '', material });
        return;
      }
      this.requests.set(source, requests + 1);
      this.components.set(source, { view: view('loading', previous?.view.bodies ?? []), bodies: previous?.bodies ?? [], stamp: previous?.stamp ?? '', material });
      this.deps.events.publish('regenerateComponent', { documentId: id, ...(configuration ? { configuration } : {}) });
      return;
    }
    this.requests.delete(source);
    const appearances = document.appearances ?? {};
    if (previous?.stamp === result.stamp && previous.view.status === 'ready') {
      this.components.set(source, { ...previous, view: { ...view('ready', previous.view.bodies), appearances }, material });
      return;
    }
    const bodies = await this.deps.modeling.restore(result.bytes, `result:${source}:${result.stamp}`);
    const meshes = bodies.length ? await this.deps.modeling.tessellate(bodies) : [];
    this.components.set(source, { view: { ...view('ready', meshes), appearances }, bodies, stamp: result.stamp, material });
  }

  /**
   * An imported 3D file used like a component: its solids are read (once per original) and named
   * like an inserted body, so joints can attach to its faces and edges.
   */
  private async loadImported(document: Extract<CadDocument, { kind: 'imported' }>): Promise<void> {
    const { id, name, assetId, format } = document;
    const missing = () => {
      this.components.set(id, { view: { id, name, status: 'missing', bodies: [] }, bodies: [], stamp: '', material: defaultMaterial });
    };
    if (this.components.get(id)?.stamp === assetId) return;
    const original = isModelFormat(format) ? await this.deps.assets.fetch(assetId) : undefined;
    if (!original || !isModelFormat(format)) return missing();
    const sources = await this.deps.interchange.readSolids(original.bytes, format, `import:${assetId}`);
    if (!sources.ok) return missing();
    const outcome = await this.deps.modeling.apply({ type: 'insert', feature: 'import', key: `imported:${assetId}`, bodies: [], sources: sources.value });
    if (outcome.error) return missing();
    const meshes = await this.deps.modeling.tessellate(outcome.bodies);
    this.components.set(id, { view: { id, name, status: 'ready', bodies: meshes }, bodies: outcome.bodies, stamp: assetId, material: defaultMaterial });
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
    return { model: { instances, joints, ...(document.links?.length ? { links: document.links } : {}) }, errors };
  }

  private async derive(document: AssemblyDocument, driven?: ReadonlySet<string>): Promise<Derived> {
    const { model, errors } = await this.model(document);
    const solution = this.deps.kinematics.solve(model, driven);
    if (solution.error) errors.set(solution.error.joint, solution.error.message);
    // Each joint's frame on A, where A is.
    const jointFrames = new Map<string, PlaneFrame>();
    for (const joint of model.joints) {
      const pose = solution.poses.get(joint.a.instance);
      if (!pose) continue;
      const m = compose(pose, frameMatrix(joint.a.frame));
      jointFrames.set(joint.id, { origin: [m[12] as number, m[13] as number, m[14] as number], u: [m[0] as number, m[1] as number, m[2] as number], v: [m[4] as number, m[5] as number, m[6] as number] });
    }
    // Copies follow their originals.
    const poses = new Map(solution.poses);
    const copies = new Map<string, { instance: string; pattern: string }>();
    for (const pattern of document.patterns ?? []) {
      const transforms = patternTransforms(pattern);
      for (const instance of pattern.instances) {
        const pose = solution.poses.get(instance);
        if (!pose) continue;
        transforms.forEach((t, k) => {
          const id = copyId(pattern.id, instance, k + 1);
          poses.set(id, compose(t, pose));
          copies.set(id, { instance, pattern: pattern.id });
        });
      }
    }
    return { poses, placed: solution.placed, values: solution.values, errors, copies, jointFrames };
  }

  /** A joint origin's frame in its component's coordinates, cached per component version. */
  private async frame(document: AssemblyDocument, origin: JointOrigin): Promise<Result<PlaneFrame>> {
    if (!origin.ref) return ok(offsetFrame(componentOrigin, origin.offset));
    const instance = document.instances.find((i) => i.id === origin.instance);
    const component = instance && this.components.get(sourceKey(instance.component, instance.configuration));
    if (!component || component.view.status !== 'ready') {
      return fail({ code: 'not-ready', message: `${component?.view.name ?? 'The component'} is ${component?.view.status === 'missing' ? 'missing' : 'still loading'}.` });
    }
    const key = `${component.stamp}|${JSON.stringify(origin.ref)}`;
    const picked = this.frames.get(key) ?? (await this.deps.modeling.frameOf(component.bodies, origin.ref));
    this.frames.set(key, picked);
    return picked.ok ? ok(offsetFrame(picked.value, origin.offset)) : picked;
  }

  /** Instances and the copies of patterns whose components are ready, where they are. */
  private readyInstances() {
    const copies = [...this.derived.copies].flatMap(([id, copy]) => {
      const original = this.document.instances.find((i) => i.id === copy.instance);
      return original ? [{ ...original, id, name: `${original.name} (copy ${id.split('/').at(-1)})` }] : [];
    });
    return [...this.document.instances, ...copies].flatMap((instance) => {
      const component = this.components.get(sourceKey(instance.component, instance.configuration));
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
