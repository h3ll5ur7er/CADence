import { computed, DestroyRef, inject, Injectable, resource, signal } from '@angular/core';
import { type DocumentId, type DocumentSummary, type LibraryPart, type LibrarySummary, standardLibraryId, type ExplodedView, type InstancePattern, type Interference, isImportedModel, type Joint, jointDofs, type JointOrigin, type JointType, type Matrix4, type Measurement, type MotionFrame, type MotionLink, type ProjectId, type Result, sourceKey, type Vec3 } from '@core/contracts';
import type { AssemblyCommand, AssemblyFormat, AssemblyProperties, AssemblySession, AssemblyState, BomLine, Collision, InstructionPicture, PlacedRef } from '@core/managers/assembly';
import { newId } from '@core/utilities/identity';
import { compose, fromFrame, invertRigid, rotationVector, transformPoint, translation, translationOf } from '@core/utilities/math';
import { ASSEMBLY_MANAGER, PROJECT_MANAGER } from '../../core.providers';
import type { Pick } from '../../viewport/picking';
import type { MoveHandle, PartDisplay } from '../../viewport/viewport-scene';
import { ChangedElsewhere } from '../changed-elsewhere';

/** One side of a joint being drawn; flat faces are remembered to mate them face to face. */
export interface DraftSide {
  readonly origin: JointOrigin;
  readonly flat: boolean;
}

/** A joint being created: its type, the two sides picked so far, and which side the next pick fills. */
export interface JointDraft {
  readonly type: JointType;
  readonly a?: DraftSide;
  readonly b?: DraftSide;
  readonly flip: boolean;
  readonly target: 'a' | 'b';
}

export type AssemblySelection = { readonly kind: 'instance' | 'joint' | 'study' | 'link' | 'view'; readonly id: string } | undefined;
export type AssemblyPanel = 'joint' | 'interference' | 'measure' | 'pattern' | 'bom' | 'library' | undefined;

/** A library part to insert (CAD-151, CAD-152), and the hole it goes into when one is picked. */
export interface LibraryDraft {
  readonly library: string;
  readonly part?: string;
  readonly hole?: JointOrigin;
  readonly flip: boolean;
}

/** The move handle of the selected instance: free ones move anywhere, jointed ones along their joint's free directions. */
export type InstanceHandle = MoveHandle & { readonly instance: string; readonly joint?: Joint };

/** Gap between a newly inserted instance and the ones already there, so it does not start inside them. */
const insertGap = 20;

/** The largest world X of the instances' bodies: where free space begins. */
function rightEdge(state: AssemblyState): number | undefined {
  let edge: number | undefined;
  for (const instance of state.document.instances) {
    const m = state.poses.get(instance.id);
    const bodies = state.components.get(sourceKey(instance.component, instance.configuration))?.bodies ?? [];
    if (!m) continue;
    for (const body of bodies) {
      const p = body.positions;
      for (let i = 0; i < p.length; i += 3) {
        const x = (m[0] as number) * (p[i] as number) + (m[4] as number) * (p[i + 1] as number) + (m[8] as number) * (p[i + 2] as number) + (m[12] as number);
        edge = edge === undefined ? x : Math.max(edge, x);
      }
    }
  }
  return edge;
}

/** The smallest X of a component's bodies, when they are known. */
function leftEdge(state: AssemblyState, component: DocumentId): number {
  let edge = 0;
  for (const body of state.components.get(component)?.bodies ?? []) for (let i = 0; i < body.positions.length; i += 3) edge = Math.min(edge, body.positions[i] as number);
  return edge;
}

const translationX = (x: number): Matrix4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1];

/**
 * Client-side state of the assembly editor: the Assembly session as signals, plus UI state (selection,
 * the joint being drawn, previews and playback). Provided per assembly mode.
 */
@Injectable()
export class AssemblyStore {
  private readonly manager = inject(ASSEMBLY_MANAGER);
  private readonly projects = inject(PROJECT_MANAGER);
  /** The assembly changed elsewhere (another window, an agent: CAD-150). */
  readonly elsewhere = new ChangedElsewhere(this.projects);
  private session: AssemblySession | undefined;
  private unsubscribe: (() => void) | undefined;
  private previewFrame: Promise<unknown> = Promise.resolve();

  readonly state = signal<AssemblyState | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly selection = signal<AssemblySelection>(undefined);
  readonly panel = signal<AssemblyPanel>(undefined);
  readonly jointDraft = signal<JointDraft | undefined>(undefined);
  readonly libraryDraft = signal<LibraryDraft | undefined>(undefined);
  /** The libraries there are, and the parts of the one chosen. */
  readonly libraries = signal<readonly LibrarySummary[]>([]);
  readonly libraryParts = signal<readonly LibraryPart[]>([]);
  private projectId: ProjectId | undefined;
  /** Poses shown instead of the document's while a slider is dragged or a study plays. */
  readonly previewPoses = signal<ReadonlyMap<string, Matrix4> | undefined>(undefined);
  readonly interference = signal<readonly Interference[] | undefined>(undefined);
  /** Components and imported 3D files of the project that can be inserted. */
  readonly insertable = signal<readonly DocumentSummary[]>([]);

  readonly parts = computed((): PartDisplay[] => {
    const state = this.state();
    if (!state) return [];
    const preview = this.previewPoses();
    const flagged = new Set([...(this.panel() === 'interference' ? (this.interference() ?? []) : []).flatMap((i) => [i.a, i.b]), ...this.flagged()]);
    // Copies of patterns show their original's component, where the pattern puts them.
    const copies = [...state.copies].flatMap(([id, copy]) => {
      const original = state.document.instances.find((i) => i.id === copy.instance);
      return original ? [{ ...original, id }] : [];
    });
    return [...state.document.instances, ...copies].flatMap((instance) => {
      const component = state.components.get(sourceKey(instance.component, instance.configuration));
      const transform = preview?.get(instance.id) ?? state.poses.get(instance.id);
      if (!component || !transform) return [];
      const part: PartDisplay = { id: instance.id, bodies: component.bodies, transform, flagged: flagged.has(instance.id), bodyAppearances: component.appearances ?? {} };
      return [instance.appearance ? { ...part, appearance: instance.appearance } : part];
    });
  });

  /** Faces, edges and vertices picked with the measure tool, on any instance. */
  readonly measurePicks = signal<readonly PlacedRef[]>([]);
  readonly measurement = signal<Result<Measurement> | undefined>(undefined);
  /** Lines from where exploded parts were to where they are shown. */
  readonly trails = signal<readonly (readonly [Vec3, Vec3])[]>([]);
  /** Instances flagged (pink) while a collision is shown. */
  readonly flagged = signal<ReadonlySet<string>>(new Set());
  readonly bom = signal<readonly BomLine[] | undefined>(undefined);
  /** A pattern being made or changed in the pattern panel. */
  readonly patternDraft = signal<InstancePattern | undefined>(undefined);

  /** Mass, volume and centre of mass of the whole assembly, recomputed as it changes. */
  readonly weight = resource({
    params: () => this.state(),
    loader: (): Promise<AssemblyProperties | undefined> => this.session?.properties() ?? Promise.resolve(undefined),
  });

  readonly handle = computed((): InstanceHandle | undefined => {
    const state = this.state();
    const selection = this.selection();
    if (!state || selection?.kind !== 'instance' || this.panel()) return undefined;
    const instance = state.document.instances.find((i) => i.id === selection.id);
    const pose = state.poses.get(selection.id);
    if (!instance || !pose) return undefined;
    if (!state.placed.has(instance.id)) {
      return instance.grounded ? undefined : { instance: instance.id, at: translation(translationOf(pose)), mode: 'translate', axes: ['X', 'Y', 'Z'] };
    }
    // Along the free directions of the joint that places it.
    const joint = state.document.joints.find((j) => j.b.instance === instance.id && state.jointFrames.has(j.id));
    const frame = joint && state.jointFrames.get(joint.id);
    if (!joint || !frame) return undefined;
    const dofs = jointDofs[joint.type];
    const moves = dofs.filter((d) => d.kind === 'translate');
    const turns = dofs.filter((d) => d.kind === 'rotate');
    const used = moves.length ? moves : turns;
    if (!used.length) return undefined;
    const { u, v } = frame;
    const n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return { instance: instance.id, joint, at: fromFrame(frame.origin, u, v, n), mode: moves.length ? 'translate' : 'rotate', axes: used.map((d) => (['X', 'Y', 'Z'] as const)[d.axis]) };
  });


  /** Faces and edges a joint origin can be put on, while a joint is drawn; anything while measuring. */
  readonly pickable = computed(() =>
    new Set<'face' | 'edge' | 'vertex'>(this.panel() === 'measure' ? ['face', 'edge', 'vertex'] : this.jointDraft() || this.libraryDraft() ? ['face', 'edge'] : ['face']),
  );

  /** The picked joint origins, shown as selected. */
  readonly picks = computed((): Pick[] => {
    if (this.panel() === 'measure') {
      return this.measurePicks().map((r) => (r.kind === 'face' ? { kind: 'face', body: r.body, name: r.name, hint: r.hint ?? [0, 0, 0], planar: false, instance: r.instance } : { kind: r.kind, body: r.body, name: r.name, hint: r.hint ?? [0, 0, 0], instance: r.instance }));
    }
    const draft = this.jointDraft();
    const origins = draft ? [draft.a?.origin, draft.b?.origin] : this.panel() === 'library' ? [this.libraryDraft()?.hole] : [];
    return origins.flatMap((o) =>
      o?.ref ? [o.ref.kind === 'face' ? { kind: 'face', body: o.ref.body, name: o.ref.name, hint: o.ref.hint ?? [0, 0, 0], planar: false, instance: o.instance } : { kind: 'edge', body: o.ref.body, name: o.ref.name, hint: o.ref.hint ?? [0, 0, 0], instance: o.instance }] : [],
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  async open(documentId: DocumentId, projectId: ProjectId): Promise<void> {
    this.close();
    this.state.set(undefined);
    this.selection.set(undefined);
    this.panel.set(undefined);
    this.libraryDraft.set(undefined);
    this.projectId = projectId;
    const opened = await this.manager.open(documentId);
    if (!opened.ok) {
      this.error.set(opened.error.message);
      return;
    }
    const session = opened.value;
    this.session = session;
    this.state.set(session.state());
    // A joint being made is input the user would lose: they are asked first (CAD-150).
    this.elsewhere.follow(documentId, () => this.state()?.document.modifiedAt, () => this.jointDraft() !== undefined, () => this.open(documentId, projectId));
    this.unsubscribe = session.subscribe((state) => this.state.set(state));
    this.insertable.set((await this.projects.listDocuments(projectId)).filter((d) => d.kind === 'component' || isImportedModel(d)));
  }

  /** Runs a command; shows its error and returns false when it was refused. */
  async run(command: AssemblyCommand): Promise<boolean> {
    if (!this.session) return false;
    const result = await this.session.execute(command);
    this.error.set(result.ok ? undefined : result.error.message);
    return result.ok;
  }

  /** The first instance is grounded at the origin; later ones start to the right of the others. */
  async insert(component: DocumentId): Promise<void> {
    const state = this.state();
    if (!state) return;
    const edge = rightEdge(state);
    const x = edge === undefined ? 0 : edge + insertGap - leftEdge(state, component);
    const id = newId();
    const grounded = state.document.instances.length === 0;
    if (await this.run({ type: 'insert-instance', instance: { id, component, name: '', transform: translationX(x), grounded } })) {
      this.select({ kind: 'instance', id });
    }
  }

  /** Shows an instance, joint or study in the properties column, closing whatever was there. */
  select(selection: AssemblySelection): void {
    this.jointDraft.set(undefined);
    this.panel.set(undefined);
    this.previewPoses.set(undefined);
    this.trails.set([]);
    this.flagged.set(new Set());
    this.selection.set(selection);
  }

  /** A new link from the first joint to the second that has a freedom, which keeps its place (offset). */
  async addLink(): Promise<void> {
    const joints = (this.state()?.document.joints ?? []).filter((j) => j.values.length > 0);
    const [driver, driven] = joints;
    if (!driver || !driven) return;
    const link: MotionLink = { id: newId(), name: '', kind: 'gear', driver: { joint: driver.id, dof: 0 }, driven: { joint: driven.id, dof: 0 }, ratio: -1, offset: (driven.values[0] ?? 0) + (driver.values[0] ?? 0) };
    if (await this.run({ type: 'set-link', link })) this.select({ kind: 'link', id: link.id });
  }

  async addExplodedView(): Promise<void> {
    const view: ExplodedView = { id: newId(), name: '', steps: [] };
    if (await this.run({ type: 'set-exploded-view', view })) this.select({ kind: 'view', id: view.id });
  }

  /** Shows an exploded view at `position` (0: assembled … the number of steps: all apart), with trails. */
  showExploded(viewId: string, position: number): void {
    const session = this.session;
    const state = this.state();
    if (!session || !state) return;
    const count = Math.ceil(position);
    const poses = session.explode(viewId, count, count > 0 ? position - (count - 1) : 1);
    this.previewPoses.set(poses);
    const moved = state.document.explodedViews?.find((v) => v.id === viewId)?.steps.slice(0, count).flatMap((s) => s.instances) ?? [];
    this.trails.set(
      [...new Set(moved)].flatMap((id) => {
        const [from, to] = [state.poses.get(id), poses.get(id)];
        const center = this.centerOf(id);
        return from && to && center ? [[transformPoint(from, center), transformPoint(to, center)] as const] : [];
      }),
    );
  }

  /** The middle of an instance's bodies, in its component's coordinates. */
  private centerOf(instanceId: string): Vec3 | undefined {
    const state = this.state();
    const instance = state?.document.instances.find((i) => i.id === instanceId);
    const bodies = instance ? (state?.components.get(sourceKey(instance.component, instance.configuration))?.bodies ?? []) : [];
    const [min, max] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const body of bodies)
      for (let i = 0; i < body.positions.length; i++) {
        const k = i % 3;
        min[k] = Math.min(min[k] as number, body.positions[i] as number);
        max[k] = Math.max(max[k] as number, body.positions[i] as number);
      }
    return Number.isFinite(min[0]) ? [((min[0] as number) + (max[0] as number)) / 2, ((min[1] as number) + (max[1] as number)) / 2, ((min[2] as number) + (max[2] as number)) / 2] : undefined;
  }

  /** The box around all instances at the given poses, to frame pictures alike. */
  boxOf(poses: ReadonlyMap<string, Matrix4>): { min: Vec3; max: Vec3 } | undefined {
    const state = this.state();
    if (!state) return undefined;
    const [min, max] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const instance of state.document.instances) {
      const m = poses.get(instance.id);
      const bodies = state.components.get(sourceKey(instance.component, instance.configuration))?.bodies ?? [];
      if (!m) continue;
      for (const body of bodies)
        for (let i = 0; i < body.positions.length; i += 3) {
          const p = transformPoint(m, [body.positions[i] as number, body.positions[i + 1] as number, body.positions[i + 2] as number]);
          p.forEach((v, k) => ((min[k] = Math.min(min[k] as number, v)), (max[k] = Math.max(max[k] as number, v))));
        }
    }
    return Number.isFinite(min[0]) ? { min: min as unknown as Vec3, max: max as unknown as Vec3 } : undefined;
  }

  /**
   * Build instructions as a PDF: pictures of the assembled state and after each step (framed alike,
   * taken by `picture`), then the Assembly Manager lays out the pages.
   */
  async exportInstructions(viewId: string, picture: (box: { min: Vec3; max: Vec3 } | undefined) => Promise<InstructionPicture | undefined>): Promise<void> {
    const session = this.session;
    const steps = this.state()?.document.explodedViews?.find((v) => v.id === viewId)?.steps.length ?? 0;
    if (!session || !steps) return;
    const box = this.boxOf(session.explode(viewId));
    const pictures: InstructionPicture[] = [];
    for (let j = 0; j <= steps; j++) {
      this.showExploded(viewId, j);
      const shot = await picture(box);
      if (!shot) return this.error.set('The view could not take a picture.');
      pictures.push(shot);
    }
    this.showExploded(viewId, steps);
    const result = await session.exportInstructions(viewId, pictures);
    this.error.set(result.ok ? undefined : result.error.message);
  }

  async collisions(studyId: string, fps: number): Promise<readonly Collision[] | undefined> {
    const result = await this.session?.collisions(studyId, fps);
    if (!result) return undefined;
    this.error.set(result.ok ? undefined : result.error.message);
    return result.ok ? result.value.collisions : undefined;
  }

  async openBom(): Promise<void> {
    this.select(undefined);
    this.panel.set('bom');
    this.bom.set(undefined);
    this.bom.set((await this.session?.billOfMaterials()) ?? []);
  }

  async exportBom(): Promise<void> {
    const result = await this.session?.exportBillOfMaterials();
    if (result && !result.ok) this.error.set(result.error.message);
  }

  /** Opens the library panel: the standard parts first (CAD-151, CAD-152). */
  async openLibrary(): Promise<void> {
    this.selection.set(undefined);
    this.jointDraft.set(undefined);
    this.panel.set('library');
    this.libraries.set(await this.projects.listLibraries());
    await this.chooseLibrary(this.libraryDraft()?.library ?? standardLibraryId);
  }

  async chooseLibrary(library: string): Promise<void> {
    this.libraryDraft.set({ library, flip: this.libraryDraft()?.flip ?? false, ...(this.libraryDraft()?.hole ? { hole: this.libraryDraft()?.hole as JointOrigin } : {}) });
    const parts = await this.projects.libraryParts(library);
    this.libraryParts.set(parts.ok ? parts.value : []);
    this.error.set(parts.ok ? undefined : parts.error.message);
  }

  updateLibrary(change: Partial<LibraryDraft>): void {
    const draft = this.libraryDraft();
    if (draft) this.libraryDraft.set({ ...draft, ...change });
  }

  /**
   * Inserts the library part chosen: the project takes it (once), and the instance goes onto the hole
   * picked with a revolute joint, its origin (a screw's head underside) on the hole's axis.
   */
  async insertFromLibrary(): Promise<void> {
    const draft = this.libraryDraft();
    const state = this.state();
    if (!draft?.part || !state || !this.projectId) return;
    const taken = await this.projects.useLibraryPart(this.projectId, draft.library, draft.part);
    if (!taken.ok) return void this.error.set(taken.error.message);
    const id = newId();
    const edge = rightEdge(state);
    const transform = draft.hole || edge === undefined ? translationX(0) : translationX(edge + insertGap);
    const joint: Joint | undefined = draft.hole && { id: newId(), name: '', type: 'revolute', a: draft.hole, b: { instance: id }, flip: draft.flip, values: [0], limits: [null] };
    const grounded = state.document.instances.length === 0;
    if (await this.run({ type: 'insert-instance', instance: { id, component: taken.value.id, name: '', transform, grounded }, ...(joint ? { joint } : {}) })) {
      // The next one goes into another hole.
      const { hole: _, ...rest } = draft;
      this.libraryDraft.set(rest);
      this.insertable.set((await this.projects.listDocuments(this.projectId)).filter((d) => d.kind === 'component' || isImportedModel(d)));
    }
  }

  closeLibrary(): void {
    this.libraryDraft.set(undefined);
    if (this.panel() === 'library') this.panel.set(undefined);
  }

  startJoint(type: JointType = 'revolute'): void {
    this.selection.set(undefined);
    this.panel.set('joint');
    this.jointDraft.set({ type, flip: false, target: 'a' });
  }

  updateJoint(change: Partial<JointDraft>): void {
    const draft = this.jointDraft();
    if (draft) this.jointDraft.set({ ...draft, ...change });
  }

  /** A click in the view: fills the next side of the joint being drawn, or selects an instance. */
  pick(pick: Pick): void {
    if (pick.kind === 'profile' || !pick.instance) return;
    if (this.panel() === 'measure') {
      const ref: PlacedRef = { instance: pick.instance, kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint };
      const same = (r: PlacedRef) => r.instance === ref.instance && r.kind === ref.kind && r.body === ref.body && r.name === ref.name;
      const picks = this.measurePicks().some(same) ? this.measurePicks().filter((r) => !same(r)) : [...this.measurePicks(), ref];
      this.measurePicks.set(picks);
      void this.measure(picks);
      return;
    }
    if (this.panel() === 'library') {
      // The hole a library part goes into: a round face or circular edge (CAD-152).
      const library = this.libraryDraft();
      if (library && !this.state()?.copies.has(pick.instance)) this.libraryDraft.set({ ...library, hole: { instance: pick.instance, ref: { kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint } } });
      return;
    }
    const draft = this.jointDraft();
    if (!draft) {
      // A pattern's copy selects its original.
      this.select({ kind: 'instance', id: this.state()?.copies.get(pick.instance)?.instance ?? pick.instance });
      return;
    }
    if (this.state()?.copies.has(pick.instance)) {
      this.error.set('Joints connect instances, not the copies of a pattern.');
      return;
    }
    const side: DraftSide = {
      origin: { instance: pick.instance, ref: { kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint } },
      flat: pick.kind === 'face' && pick.planar,
    };
    const next: JointDraft = { ...draft, [draft.target]: side, target: draft.target === 'a' ? 'b' : 'a' };
    // Two flat faces meet face to face, so the second side is turned over.
    this.jointDraft.set({ ...next, flip: Boolean(next.a?.flat && next.b?.flat) });
  }

  async commitJoint(): Promise<void> {
    const draft = this.jointDraft();
    if (!draft?.a || !draft.b) return;
    const dofs = jointDofs[draft.type];
    const joint: Joint = { id: newId(), name: '', type: draft.type, a: draft.a.origin, b: draft.b.origin, flip: draft.flip, values: dofs.map(() => 0), limits: dofs.map(() => null) };
    if (await this.run({ type: 'add-joint', joint })) {
      this.jointDraft.set(undefined);
      this.panel.set(undefined);
      this.selection.set({ kind: 'joint', id: joint.id });
    }
  }

  cancelJoint(): void {
    this.jointDraft.set(undefined);
    if (this.panel() === 'joint') this.panel.set(undefined);
    this.error.set(undefined);
  }

  /** Shows a joint at other values while a slider is dragged; later moves win. */
  preview(jointId: string, values: readonly number[]): void {
    const session = this.session;
    if (!session) return;
    this.previewFrame = this.previewFrame.then(async () => {
      const result = await session.previewJoint(jointId, values);
      if (result.ok) this.previewPoses.set(result.value);
    });
  }

  async setJointValues(jointId: string, values: readonly number[]): Promise<void> {
    await this.previewFrame;
    await this.run({ type: 'set-joint-values', jointId, values });
    this.previewPoses.set(undefined);
  }

  async motion(studyId: string, fps: number): Promise<readonly MotionFrame[] | undefined> {
    const result = await this.session?.motion(studyId, fps);
    if (!result) return undefined;
    this.error.set(result.ok ? undefined : result.error.message);
    return result.ok ? result.value : undefined;
  }

  /** Opens the measure tool, or closes it. */
  toggleMeasure(): void {
    const open = this.panel() !== 'measure';
    this.select(undefined);
    this.measurePicks.set([]);
    this.measurement.set(undefined);
    this.panel.set(open ? 'measure' : undefined);
  }

  private async measure(picks: readonly PlacedRef[]): Promise<void> {
    this.measurement.set(picks.length ? await this.session?.measure(picks) : undefined);
  }

  /** Starts a pattern of the selected instance (or the first one), or edits an existing pattern. */
  startPattern(kind: InstancePattern['kind'], existing?: InstancePattern): void {
    const state = this.state();
    if (!state) return;
    const selected = this.selection()?.kind === 'instance' ? this.selection()?.id : undefined;
    const first = selected ?? state.document.instances[0]?.id;
    const pattern: InstancePattern = existing ?? {
      id: newId(),
      name: '',
      kind,
      instances: first ? [first] : [],
      direction: kind === 'mirror' ? [1, 0, 0] : kind === 'circular' ? [0, 0, 1] : [1, 0, 0],
      origin: [0, 0, 0],
      count: kind === 'circular' ? 4 : 3,
      spacing: kind === 'circular' ? 90 : 50,
    };
    this.select(undefined);
    this.patternDraft.set(pattern);
    this.panel.set('pattern');
  }

  async commitPattern(): Promise<void> {
    const pattern = this.patternDraft();
    if (pattern && (await this.run({ type: 'set-pattern', pattern }))) {
      this.patternDraft.set(undefined);
      this.panel.set(undefined);
    }
  }

  /** The move handle was dragged to `at`: a free instance moves with it; a jointed one changes its joint's values. */
  async moveHandle(at: readonly number[], done: boolean): Promise<void> {
    const handle = this.handle();
    const state = this.state();
    const pose = handle && state?.poses.get(handle.instance);
    if (!handle || !state || !pose) return;
    if (!handle.joint) {
      const [from, to] = [translationOf(handle.at), translationOf(at)];
      const moved = compose(translation([to[0] - from[0], to[1] - from[1], to[2] - from[2]]), pose);
      if (!done) return this.previewPoses.set(new Map([...state.poses, [handle.instance, moved]]));
      this.previewPoses.set(undefined);
      await this.run({ type: 'move-instance', instanceId: handle.instance, transform: moved });
      return;
    }
    // How far the handle moved and turned, in the joint's own axes.
    const relative = compose(invertRigid(handle.at), at);
    const [move, turn] = [translationOf(relative), rotationVector(relative)];
    const joint = handle.joint;
    const values = jointDofs[joint.type].map((dof, i) => (joint.values[i] ?? 0) + (dof.kind === 'translate' ? move[dof.axis] : (turn[dof.axis] * 180) / Math.PI));
    if (done) await this.setJointValues(joint.id, values);
    else this.preview(joint.id, values);
  }

  async checkInterference(): Promise<void> {
    this.jointDraft.set(undefined);
    this.panel.set('interference');
    this.interference.set(undefined);
    this.interference.set((await this.session?.interference()) ?? []);
  }

  async exportAssembly(format: AssemblyFormat): Promise<void> {
    const result = await this.session?.exportAssembly(format);
    if (result && !result.ok) this.error.set(result.error.message);
  }

  /** The assembly as one HTML file with a viewer, to share. */
  async exportViewer(): Promise<void> {
    const result = await this.session?.exportViewer();
    if (result && !result.ok) this.error.set(result.error.message);
  }

  async saveRecording(bytes: Uint8Array, studyName: string): Promise<void> {
    await this.session?.saveRecording(bytes, studyName);
  }

  async undo(): Promise<void> {
    await this.session?.undo();
    this.error.set(undefined);
  }

  async redo(): Promise<void> {
    await this.session?.redo();
    this.error.set(undefined);
  }

  private close(): void {
    this.unsubscribe?.();
    this.elsewhere.close();
    this.session?.close();
    this.session = undefined;
  }
}
