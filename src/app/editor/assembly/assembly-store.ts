import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { type DocumentId, type DocumentSummary, type Interference, isImportedModel, type Joint, jointDofs, type JointOrigin, type JointType, type Matrix4, type MotionFrame, type ProjectId, sourceKey } from '@core/contracts';
import type { AssemblyCommand, AssemblyFormat, AssemblySession, AssemblyState } from '@core/managers/assembly';
import { newId } from '@core/utilities/identity';
import { ASSEMBLY_MANAGER, PROJECT_MANAGER } from '../../core.providers';
import type { Pick } from '../../viewport/picking';
import type { PartDisplay } from '../../viewport/viewport-scene';

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

export type AssemblySelection = { readonly kind: 'instance' | 'joint' | 'study'; readonly id: string } | undefined;
export type AssemblyPanel = 'joint' | 'interference' | undefined;

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
  private session: AssemblySession | undefined;
  private unsubscribe: (() => void) | undefined;
  private previewFrame: Promise<unknown> = Promise.resolve();

  readonly state = signal<AssemblyState | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly selection = signal<AssemblySelection>(undefined);
  readonly panel = signal<AssemblyPanel>(undefined);
  readonly jointDraft = signal<JointDraft | undefined>(undefined);
  /** Poses shown instead of the document's while a slider is dragged or a study plays. */
  readonly previewPoses = signal<ReadonlyMap<string, Matrix4> | undefined>(undefined);
  readonly interference = signal<readonly Interference[] | undefined>(undefined);
  /** Components and imported 3D files of the project that can be inserted. */
  readonly insertable = signal<readonly DocumentSummary[]>([]);

  readonly parts = computed((): PartDisplay[] => {
    const state = this.state();
    if (!state) return [];
    const preview = this.previewPoses();
    const flagged = new Set((this.panel() === 'interference' ? (this.interference() ?? []) : []).flatMap((i) => [i.a, i.b]));
    return state.document.instances.flatMap((instance) => {
      const component = state.components.get(sourceKey(instance.component, instance.configuration));
      const transform = preview?.get(instance.id) ?? state.poses.get(instance.id);
      if (!component || !transform) return [];
      const part: PartDisplay = { id: instance.id, bodies: component.bodies, transform, flagged: flagged.has(instance.id), bodyAppearances: component.appearances ?? {} };
      return [instance.appearance ? { ...part, appearance: instance.appearance } : part];
    });
  });

  /** Faces and edges a joint origin can be put on, while a joint is drawn. */
  readonly pickable = computed(() => new Set(this.jointDraft() ? (['face', 'edge'] as const) : (['face'] as const)));

  /** The picked joint origins, shown as selected. */
  readonly picks = computed((): Pick[] => {
    const draft = this.jointDraft();
    const origins = draft ? [draft.a?.origin, draft.b?.origin] : [];
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
    const opened = await this.manager.open(documentId);
    if (!opened.ok) {
      this.error.set(opened.error.message);
      return;
    }
    const session = opened.value;
    this.session = session;
    this.state.set(session.state());
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
    this.selection.set(selection);
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
    const draft = this.jointDraft();
    if (!draft) {
      this.select({ kind: 'instance', id: pick.instance });
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
    this.session?.close();
    this.session = undefined;
  }
}
