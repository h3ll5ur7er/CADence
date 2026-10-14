import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { type DocumentId, type Feature, type FeatureType, isSketch, type Parameter, type PlaneRef } from '@core/contracts';
import type { DesignCommand, DesignSession, DesignState, DrawingFormat, SketchView, SolidFormat } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { DESIGN_MANAGER } from '../../core.providers';
import type { Pick, PickKind } from '../../viewport/picking';
import { applyPick, defaultFeature, type FeatureDraft, type PickTarget, pickableFor, selectionOf } from '../modeling/feature-drafts';
import type { Tool } from './sketch-tools';

/**
 * Client-side state of one component editor: the Design session as signals, plus pure UI state
 * (which sketch is edited, the active tool, the selection). Provided per component mode.
 */
@Injectable()
export class DesignStore {
  private readonly manager = inject(DESIGN_MANAGER);
  private session: DesignSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private dragFrame: Promise<unknown> = Promise.resolve();

  readonly state = signal<DesignState | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly editing = signal<string | undefined>(undefined);
  readonly tool = signal<Tool>('select');
  readonly selection = signal<readonly string[]>([]);
  /** A solved drag that is not committed yet. */
  readonly preview = signal<SketchView | undefined>(undefined);
  /** The feature being created or edited. */
  readonly draft = signal<FeatureDraft | undefined>(undefined);
  /** A face picked in the 3D view outside dialogs (for sketching on it). */
  readonly pickedFace = signal<Extract<Pick, { kind: 'face' }> | undefined>(undefined);
  readonly parametersOpen = signal(false);

  readonly pickable = computed((): ReadonlySet<PickKind> => (this.editing() ? new Set() : pickableFor(this.draft())));
  readonly picks = computed((): readonly Pick[] => {
    const draft = this.draft();
    if (draft) return selectionOf(draft);
    const face = this.pickedFace();
    return face ? [face] : [];
  });

  readonly editedView = computed(() => {
    const id = this.editing();
    if (!id) return undefined;
    const preview = this.preview();
    return preview?.sketch.id === id ? preview : this.state()?.sketches.get(id);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unsubscribe?.());
  }

  async open(documentId: DocumentId): Promise<void> {
    this.unsubscribe?.();
    this.reset();
    const opened = await this.manager.open(documentId);
    if (!opened.ok) {
      this.error.set(opened.error.message);
      return;
    }
    this.session = opened.value;
    this.state.set(this.session.state());
    this.unsubscribe = this.session.subscribe((state) => {
      this.state.set(state);
      if (this.editing() && !state.sketches.has(this.editing() as string)) this.finishEditing();
    });
  }

  /** Runs a command; shows its error and returns false when it was rejected. */
  async run(command: DesignCommand): Promise<boolean> {
    if (!this.session) return false;
    const result = await this.session.execute(command);
    this.error.set(result.ok ? undefined : result.error.message);
    return result.ok;
  }

  async createSketch(plane: PlaneRef): Promise<void> {
    const id = newId();
    this.cancelDraft();
    if (await this.run({ type: 'create-sketch', id, plane })) this.edit(id, 'line');
  }

  /** A click in the 3D view: feeds the open dialog, or picks a face to sketch on. */
  pick(pick: Pick): void {
    if (this.editing()) return;
    const draft = this.draft();
    if (draft) {
      this.draft.set(applyPick(draft, pick));
      return;
    }
    if (pick.kind !== 'face') return;
    const current = this.pickedFace();
    this.pickedFace.set(current?.name === pick.name && current.body === pick.body ? undefined : pick);
  }

  startFeature(type: FeatureType): void {
    const state = this.state();
    if (!state) return;
    this.finishEditing();
    this.parametersOpen.set(false);
    this.pickedFace.set(undefined);
    this.draft.set({ mode: 'create', feature: defaultFeature(type, newId(), state) });
  }

  editFeature(id: string): void {
    const feature = this.state()?.document.timeline.find((item): item is Feature => item.id === id && !isSketch(item));
    if (!feature) return;
    this.finishEditing();
    this.parametersOpen.set(false);
    this.draft.set({ mode: 'edit', feature });
  }

  updateDraft(feature: Feature, target?: PickTarget): void {
    const draft = this.draft();
    if (draft) this.draft.set(target ? { mode: draft.mode, feature, target } : { mode: draft.mode, feature });
  }

  /** Applies the dialog; it stays open with the reason when the feature fails. */
  async commitDraft(): Promise<void> {
    const draft = this.draft();
    if (!draft) return;
    const ok = await this.run(draft.mode === 'create' ? { type: 'add-feature', feature: draft.feature } : { type: 'edit-feature', feature: draft.feature });
    if (ok) this.draft.set(undefined);
  }

  cancelDraft(): void {
    this.draft.set(undefined);
    this.error.set(undefined);
  }

  async setParameter(parameter: Parameter, isNew: boolean): Promise<boolean> {
    return this.run(isNew ? { type: 'add-parameter', parameter } : { type: 'set-parameter', parameter });
  }

  async exportBodies(format: SolidFormat): Promise<void> {
    const result = await this.session?.exportBodies(format);
    if (result && !result.ok) this.error.set(result.error.message);
  }

  volumes(): Promise<Record<string, number>> {
    return this.session?.volumes() ?? Promise.resolve({});
  }

  /** New sketches start drawing; existing ones start selecting. */
  edit(sketchId: string, tool: Tool = 'select'): void {
    this.editing.set(sketchId);
    this.tool.set(tool);
    this.selection.set([]);
    this.error.set(undefined);
  }

  finishEditing(): void {
    this.editing.set(undefined);
    this.tool.set('select');
    this.selection.set([]);
    this.preview.set(undefined);
  }

  select(ids: readonly string[]): void {
    this.selection.set(ids);
  }

  /** Previews a point drag; at most one solve runs at a time, later moves win. */
  drag(pointId: string, x: number, y: number): void {
    const sketchId = this.editing();
    if (!sketchId || !this.session) return;
    const session = this.session;
    this.dragFrame = this.dragFrame.then(async () => {
      this.preview.set(await session.previewDrag(sketchId, pointId, x, y));
    });
  }

  async drop(pointId: string, x: number, y: number): Promise<void> {
    const sketchId = this.editing();
    await this.dragFrame;
    if (sketchId) await this.run({ type: 'move-point', sketchId, pointId, x, y });
    this.preview.set(undefined);
  }

  async undo(): Promise<void> {
    await this.session?.undo();
    this.error.set(undefined);
  }

  async redo(): Promise<void> {
    await this.session?.redo();
    this.error.set(undefined);
  }

  async exportSketch(sketchId: string, format: DrawingFormat): Promise<void> {
    const result = await this.session?.exportSketch(sketchId, format);
    if (result && !result.ok) this.error.set(result.error.message);
  }

  private reset(): void {
    this.session = undefined;
    this.state.set(undefined);
    this.finishEditing();
    this.error.set(undefined);
  }
}
