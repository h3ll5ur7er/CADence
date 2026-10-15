import { computed, DestroyRef, inject, Injectable, resource, signal } from '@angular/core';
import {
  type BodyProperties,
  type DocumentId,
  type DocumentSummary,
  isImportedDrawing,
  isImportedModel,
  type ProjectId,
  type Feature,
  type FeatureType,
  isSketch,
  manufacturingProfiles,
  type ManufacturingProfile,
  type Measurement,
  type Parameter,
  type PlaneRef,
  type Result,
  type TopologyRef,
  type ValidationReport,
} from '@core/contracts';
import type { DesignCommand, DesignSession, DesignState, DrawingFormat, SketchView, SolidFormat } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { DESIGN_MANAGER, PROJECT_MANAGER } from '../../core.providers';
import type { Pick, PickKind, TopologyPick } from '../../viewport/picking';
import { applyPick, defaultFeature, type FeatureDraft, type PickTarget, pickableFor, selectionOf } from '../modeling/feature-drafts';
import type { SketchClipboard } from './selection';
import type { Tool } from './sketch-tools';

/** What the properties column shows besides feature dialogs and sketch info. */
export type SidePanel = 'parameters' | 'measure' | 'check';

const toRef = (pick: TopologyPick): TopologyRef => ({ kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint });

/**
 * Client-side state of one component editor: the Design session as signals, plus pure UI state
 * (which sketch is edited, the active tool, the selection). Provided per component mode.
 */
@Injectable()
export class DesignStore {
  private readonly manager = inject(DESIGN_MANAGER);
  private readonly projects = inject(PROJECT_MANAGER);
  private session: DesignSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private dragFrame: Promise<unknown> = Promise.resolve();

  readonly state = signal<DesignState | undefined>(undefined);
  readonly error = signal<string | undefined>(undefined);
  readonly editing = signal<string | undefined>(undefined);
  readonly tool = signal<Tool>('select');
  /** Corners of the polygon tool. */
  readonly polygonSides = signal(6);
  /** Sketch geometry copied or cut, to paste into this or another sketch. */
  readonly sketchClipboard = signal<SketchClipboard | undefined>(undefined);
  /** Copies (the original counts) a circular pattern makes when its centre is clicked. */
  readonly patternCount = signal(6);
  /** Radius of the sketch fillet tool and length of the chamfer tool, mm. */
  readonly cornerSize = signal(2);
  readonly selection = signal<readonly string[]>([]);
  /** A solved drag that is not committed yet. */
  readonly preview = signal<SketchView | undefined>(undefined);
  /** The feature being created or edited. */
  readonly draft = signal<FeatureDraft | undefined>(undefined);
  /** A face picked in the 3D view outside dialogs (for sketching on it). */
  readonly pickedFace = signal<Extract<Pick, { kind: 'face' }> | undefined>(undefined);
  readonly panel = signal<SidePanel | undefined>(undefined);
  /** The project's documents, for inserting imported files. */
  readonly projectDocuments = signal<readonly DocumentSummary[]>([]);
  readonly importedModels = computed(() => this.projectDocuments().filter(isImportedModel));
  readonly importedDrawings = computed(() => this.projectDocuments().filter(isImportedDrawing));
  /** Faces, edges and vertices picked with the measure tool. */
  readonly measurePicks = signal<readonly TopologyPick[]>([]);
  /** The check whose faces are highlighted; the first one with faces when unset. */
  readonly focusedCheck = signal<string | undefined>(undefined);

  readonly pickable = computed((): ReadonlySet<PickKind> => {
    // While sketching, the project tool picks edges and faces of bodies to project.
    if (this.editing()) return this.tool() === 'project' ? new Set<PickKind>(['edge', 'face']) : new Set<PickKind>();
    if (!this.draft() && this.panel() === 'measure') return new Set<PickKind>(['face', 'edge', 'vertex']);
    return pickableFor(this.draft());
  });
  readonly picks = computed((): readonly Pick[] => {
    const draft = this.draft();
    if (draft) return selectionOf(draft);
    if (this.panel() === 'measure') return this.measurePicks();
    const face = this.pickedFace();
    return face ? [face] : [];
  });

  /** The manufacturing profile in effect. */
  readonly process = computed(() => this.state()?.document.process ?? (manufacturingProfiles[0] as ManufacturingProfile));

  /** What the measure tool shows for the current picks; recomputed when the model changes. */
  readonly measurement = resource({
    params: () => (this.panel() === 'measure' && this.measurePicks().length ? { picks: this.measurePicks(), state: this.state() } : undefined),
    loader: ({ params }): Promise<Result<Measurement> | undefined> => this.session?.measure(params.picks.map(toRef)) ?? Promise.resolve(undefined),
  });

  /** The validation report while the check panel is open; re-run after every change. */
  readonly report = resource({
    params: () => (this.panel() === 'check' ? { state: this.state() } : undefined),
    loader: (): Promise<ValidationReport | undefined> => this.session?.validate() ?? Promise.resolve(undefined),
  });

  /** Faces the focused check is about, for the viewport. */
  readonly flagged = computed((): readonly TopologyRef[] => {
    if (this.panel() !== 'check') return [];
    const checks = this.report.value()?.checks ?? [];
    const focused = this.focusedCheck();
    const check = focused ? checks.find((c) => c.id === focused) : checks.find((c) => c.status !== 'pass' && c.faces?.length);
    return check?.faces ?? [];
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

  async open(documentId: DocumentId, projectId: ProjectId): Promise<void> {
    this.unsubscribe?.();
    this.reset();
    void this.projects.listDocuments(projectId).then((documents) => this.projectDocuments.set(documents));
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
    const sketchId = this.editing();
    if (sketchId) {
      if (this.tool() === 'project' && (pick.kind === 'edge' || pick.kind === 'face')) void this.project(sketchId, pick);
      return;
    }
    const draft = this.draft();
    if (draft) {
      this.draft.set(applyPick(draft, pick));
      return;
    }
    if (this.panel() === 'measure') {
      if (pick.kind === 'profile') return;
      const picks = this.measurePicks();
      const same = (p: Pick) => p.kind === pick.kind && p.body === pick.body && p.name === pick.name;
      this.measurePicks.set(picks.some(same) ? picks.filter((p) => !same(p)) : [...picks, pick]);
      return;
    }
    if (pick.kind !== 'face') return;
    const current = this.pickedFace();
    this.pickedFace.set(current?.name === pick.name && current.body === pick.body ? undefined : pick);
  }

  /** Projects a picked edge or face (its outline) into the sketch being edited. */
  private async project(sketchId: string, pick: Extract<Pick, { kind: 'edge' | 'face' }>): Promise<void> {
    const projection = { id: newId(), kind: 'projection' as const, refs: [toRef(pick)], construction: false };
    await this.run({ type: 'add-sketch-geometry', sketchId, entities: [projection], constraints: [] });
  }

  startFeature(type: FeatureType): void {
    const state = this.state();
    if (!state) return;
    this.finishEditing();
    this.panel.set(undefined);
    this.pickedFace.set(undefined);
    this.draft.set({ mode: 'create', feature: defaultFeature(type, newId(), state, this.importedModels().map((d) => d.id)) });
  }

  editFeature(id: string): void {
    const feature = this.state()?.document.timeline.find((item): item is Feature => item.id === id && !isSketch(item));
    if (!feature) return;
    this.finishEditing();
    this.panel.set(undefined);
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

  /** Opens a side panel (or closes it with `undefined`), leaving sketches and dialogs. */
  openPanel(panel: SidePanel | undefined): void {
    this.cancelDraft();
    this.finishEditing();
    this.pickedFace.set(undefined);
    this.measurePicks.set([]);
    this.focusedCheck.set(undefined);
    this.panel.set(panel);
  }

  properties(): Promise<BodyProperties[]> {
    return this.session?.properties() ?? Promise.resolve([]);
  }

  /** New sketches start drawing; existing ones start selecting. */
  edit(sketchId: string, tool: Tool = 'select'): void {
    this.panel.set(undefined);
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

  /** Adds an imported drawing's curves to the edited sketch. */
  async insertDrawing(documentId: DocumentId): Promise<void> {
    const sketchId = this.editing();
    if (!sketchId || !this.session) return;
    const result = await this.session.insertDrawing(sketchId, documentId, `${newId()}-`);
    this.error.set(result.ok ? undefined : result.error.message);
  }

  async exportSketch(sketchId: string, format: DrawingFormat, compensateKerf = false): Promise<void> {
    const result = await this.session?.exportSketch(sketchId, format, { compensateKerf });
    if (result && !result.ok) this.error.set(result.error.message);
  }

  private reset(): void {
    this.session = undefined;
    this.state.set(undefined);
    this.panel.set(undefined);
    this.measurePicks.set([]);
    this.finishEditing();
    this.error.set(undefined);
  }
}
