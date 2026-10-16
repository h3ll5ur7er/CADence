import { computed, DestroyRef, inject, Injectable, resource, signal } from '@angular/core';
import {
  type BodyProperties,
  type DocumentId,
  type DocumentSummary,
  isImportedDrawing,
  isImportedModel,
  isImportedFont,
  isImportedPicture,
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
  type SimulationLoad,
  type SimulationResult,
  type SimulationSetup,
  type TopologyRef,
  type Vec3,
  type ValidationReport,
  type LengthUnit,
  type SketchFreedom,
} from '@core/contracts';
import type { BrokenReference, ConfigurationImport, DesignCommand, DesignSession, DesignState, DrawingFormat, ExportOptions, InsertDrawingOptions, SketchView, SolidFormat } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { DESIGN_MANAGER, PROJECT_MANAGER } from '../../core.providers';
import { pictureUrl } from '../../shared/picture-url';
import type { Pick, PickKind, TopologyPick } from '../../viewport/picking';
import type { StressField } from '../../viewport/surface-analysis';
import { applyPick, defaultFeature, type FeatureDraft, type PickTarget, pickableFor, selectionOf } from '../modeling/feature-drafts';
import type { SketchClipboard } from './selection';
import type { TextDraft, Tool } from './sketch-tools';

/** What the properties column shows besides feature dialogs and sketch info. */
export type SidePanel = 'parameters' | 'measure' | 'check' | 'repair' | 'simulate';

const toRef = (pick: TopologyPick): TopologyRef => ({ kind: pick.kind, body: pick.body, name: pick.name, hint: pick.hint });
const pickOfRef = (ref: TopologyRef): Pick =>
  ref.kind === 'face' ? { kind: 'face', body: ref.body, name: ref.name, hint: ref.hint ?? [0, 0, 0], planar: false } : { kind: ref.kind, body: ref.body, name: ref.name, hint: ref.hint ?? [0, 0, 0] };

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
  /** A sketch command refused because it contradicts relations or dimensions the sketch has: those, and the command to try again. */
  readonly conflict = signal<{ readonly sketchId: string; readonly constraints: readonly string[]; readonly command: DesignCommand } | undefined>(undefined);
  readonly editing = signal<string | undefined>(undefined);
  readonly tool = signal<Tool>('select');
  /** Corners of the polygon tool. */
  readonly polygonSides = signal(6);
  /** Sketch geometry copied or cut, to paste into this or another sketch. */
  readonly sketchClipboard = signal<SketchClipboard | undefined>(undefined);
  /** What the text tool places. */
  readonly textDraft = signal<TextDraft>({ text: 'CADence', height: 5, weight: 'regular' });
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
  readonly importedDrawings = computed(() => this.projectDocuments().filter((d) => isImportedDrawing(d) || isImportedPicture(d)));
  readonly importedPictures = computed(() => this.projectDocuments().filter(isImportedPicture));
  readonly importedFonts = computed(() => this.projectDocuments().filter(isImportedFont));

  /** Imports a font file into the project; returns its document for texts to use. */
  async importFont(file: { readonly name: string; readonly bytes: Uint8Array }): Promise<DocumentSummary | undefined> {
    if (!this.projectId) return undefined;
    const result = await this.projects.importFile(this.projectId, file);
    if (!result.ok) {
      this.error.set(result.error.message);
      return undefined;
    }
    this.projectDocuments.set(await this.projects.listDocuments(this.projectId));
    return result.value;
  }
  /** The item whose lost references are being repaired, and where the rollback marker was before. */
  readonly repairing = signal<{ readonly itemId: string; readonly restore: number } | undefined>(undefined);
  /** What the repaired item lost, with candidates. */
  readonly broken = signal<readonly BrokenReference[]>([]);
  /** Which lost reference a pick in the view replaces. */
  readonly repairTarget = signal(0);
  /** Faces, edges and vertices picked with the measure tool. */
  readonly measurePicks = signal<readonly TopologyPick[]>([]);
  /** The check whose faces are highlighted; the first one with faces when unset. */
  readonly focusedCheck = signal<string | undefined>(undefined);
  /** Whether a face picked with the simulate panel open is held fixed or gets a load. */
  readonly simulationPick = signal<'fixed' | 'load'>('fixed');
  /** The strength check's setup as stored in the component. */
  readonly simulationSetup = computed((): SimulationSetup => this.state()?.document.simulation ?? { fixed: [], loads: [] });
  /** The last strength check and the state it was run on. */
  private readonly simulation = signal<{ readonly state: DesignState | undefined; readonly result: Result<SimulationResult> } | undefined>(undefined);
  readonly simulating = signal(false);
  /** The last strength check while the model is unchanged since. */
  readonly simulationResult = computed(() => {
    const run = this.simulation();
    return run && run.state === this.state() ? run.result : undefined;
  });
  /** Shows the bodies bent by the loads, exaggerated. */
  readonly showDeformed = signal(true);
  /** Stresses (and the bent shape) for the viewport while the simulate panel is open. */
  readonly stressField = computed((): StressField | undefined => {
    const result = this.simulationResult();
    if (this.panel() !== 'simulate' || !result?.ok) return undefined;
    const { value } = result;
    // Bent so the largest deflection shows as a twentieth of the model's size.
    const [min, max] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]];
    for (const body of this.state()?.bodies ?? [])
      body.positions.forEach((v, i) => {
        min[i % 3] = Math.min(min[i % 3] as number, v);
        max[i % 3] = Math.max(max[i % 3] as number, v);
      });
    const size = Math.max(...max.map((v, k) => v - (min[k] as number)));
    const deform = this.showDeformed() && value.maxDisplacement > 0 ? (0.05 * size) / value.maxDisplacement : 0;
    return { bodies: new Map(value.bodies.map((b) => [b.body, b])), max: value.maxStress, deform };
  });

  readonly pickable = computed((): ReadonlySet<PickKind> => {
    // While sketching, the project tool picks edges and faces of bodies to project.
    if (this.editing()) return this.tool() === 'project' ? new Set<PickKind>(['edge', 'face']) : new Set<PickKind>();
    if (!this.draft() && this.panel() === 'measure') return new Set<PickKind>(['face', 'edge', 'vertex']);
    if (!this.draft() && this.panel() === 'simulate') return new Set<PickKind>(['face']);
    if (!this.draft() && this.panel() === 'repair') {
      const target = this.broken()[this.repairTarget()];
      return new Set<PickKind>(target ? [target.ref.kind] : []);
    }
    return pickableFor(this.draft());
  });
  readonly picks = computed((): readonly Pick[] => {
    const draft = this.draft();
    if (draft) return selectionOf(draft);
    if (this.panel() === 'measure') return this.measurePicks();
    if (this.panel() === 'simulate') return this.simulationSetup().fixed.map(pickOfRef);
    // While repairing, the candidates for the lost reference light up.
    if (this.panel() === 'repair') return (this.broken()[this.repairTarget()]?.candidates ?? []).map(({ ref }) => pickOfRef(ref));
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
    // Loaded faces stand out from the fixed ones (the selection).
    if (this.panel() === 'simulate') return this.simulationResult()?.ok ? [] : this.simulationSetup().loads.map((l) => l.face);
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

  /** The parameters of the open component's project (all of them, also those the component overrides). */
  readonly projectParameters = signal<readonly Parameter[]>([]);
  private projectId: ProjectId | undefined;

  async open(documentId: DocumentId, projectId: ProjectId): Promise<void> {
    this.unsubscribe?.();
    this.reset();
    this.projectId = projectId;
    void this.projects.listDocuments(projectId).then((documents) => this.projectDocuments.set(documents));
    void this.projects.findProject(projectId).then((project) => this.projectParameters.set(project?.parameters ?? []));
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
  /** The unit the edited component shows and takes lengths in. */
  readonly units = computed((): LengthUnit => this.state()?.document.units ?? 'mm');

  async run(command: DesignCommand): Promise<boolean> {
    if (!this.session) return false;
    const result = await this.session.execute(command);
    this.error.set(result.ok ? undefined : result.error.message);
    const sketchId = 'sketchId' in command ? command.sketchId : undefined;
    this.conflict.set(!result.ok && sketchId && result.error.related?.length ? { sketchId, constraints: result.error.related, command } : undefined);
    return result.ok;
  }

  /** Removes one of the relations or dimensions a refused command conflicted with, then runs that command again. */
  async resolveConflict(constraintId: string): Promise<void> {
    const conflict = this.conflict();
    if (!conflict) return;
    if (await this.run({ type: 'delete-sketch-elements', sketchId: conflict.sketchId, ids: [constraintId] })) await this.run(conflict.command);
  }

  /** What a sketch's relations and dimensions leave free. */
  async freedom(sketchId: string): Promise<SketchFreedom> {
    return (await this.session?.freedom(sketchId)) ?? { points: [], radii: [] };
  }

  /** Adds the relations and dimensions that fully define a sketch as it is drawn (one change); returns how many. */
  async fullyDefine(sketchId: string): Promise<number> {
    const constraints = (await this.session?.suggestConstraints(sketchId, `${newId()}-`)) ?? [];
    if (!constraints.length) {
      this.error.set('No relations or dimensions could be found that define more of this sketch.');
      return 0;
    }
    return (await this.run({ type: 'add-sketch-geometry', sketchId, entities: [], constraints })) ? constraints.length : 0;
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
    if (this.panel() === 'repair') {
      const target = this.broken()[this.repairTarget()];
      if (target && pick.kind === target.ref.kind) void this.replaceReference(target.ref, toRef(pick));
      return;
    }
    if (this.panel() === 'simulate') {
      if (pick.kind === 'face') void this.toggleSimulationFace(toRef(pick));
      return;
    }
    if (pick.kind !== 'face') return;
    const current = this.pickedFace();
    this.pickedFace.set(current?.name === pick.name && current.body === pick.body ? undefined : pick);
  }

  /** Holds a face fixed or loads it (100 N into it), or takes that back. */
  private async toggleSimulationFace(face: TopologyRef): Promise<void> {
    const setup = this.simulationSetup();
    const same = (ref: TopologyRef) => ref.body === face.body && ref.name === face.name;
    if (this.simulationPick() === 'fixed') {
      await this.setSimulation({ ...setup, fixed: setup.fixed.some(same) ? setup.fixed.filter((r) => !same(r)) : [...setup.fixed, face] });
      return;
    }
    const loads: SimulationLoad[] = setup.loads.some((l) => same(l.face))
      ? setup.loads.filter((l) => !same(l.face))
      : [...setup.loads, { kind: 'force', face, force: 100, direction: this.inward(face) }];
    await this.setSimulation({ ...setup, loads });
  }

  /** Into a face: against its normal (where it starts, for curved faces). */
  inward(face: TopologyRef): Vec3 {
    const mesh = this.state()?.bodies.find((b) => b.body === face.body);
    const meshFace = mesh?.faces.find((f) => f.name === face.name);
    if (!mesh || !meshFace) return [0, 0, -1];
    const vertex = mesh.indices[meshFace.start] as number;
    return [0, 1, 2].map((k) => Math.round(-(mesh.normals[vertex * 3 + k] as number) * 1e6) / 1e6 || 0) as unknown as Vec3;
  }

  async setSimulation(setup: SimulationSetup): Promise<void> {
    await this.run({ type: 'set-simulation', setup });
  }

  /** Runs the strength check (seconds for detailed parts). */
  async simulate(): Promise<void> {
    if (!this.session || this.simulating()) return;
    this.simulating.set(true);
    const state = this.state();
    try {
      this.simulation.set({ state, result: await this.session.simulate() });
    } finally {
      this.simulating.set(false);
    }
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

  /** Replaces the project's parameters; every component of the project regenerates. */
  async setProjectParameters(parameters: readonly Parameter[]): Promise<boolean> {
    if (!this.projectId) return false;
    const result = await this.projects.setProjectParameters(this.projectId, parameters);
    this.error.set(result.ok ? undefined : result.error.message);
    if (result.ok) this.projectParameters.set(parameters);
    return result.ok;
  }

  async exportFlatPattern(format: DrawingFormat): Promise<void> {
    const result = await this.session?.exportFlatPattern(format);
    if (result && !result.ok) this.error.set(result.error.message);
  }

  async exportBodies(format: SolidFormat, options?: ExportOptions): Promise<void> {
    const result = await this.session?.exportBodies(format, options);
    if (result && !result.ok) this.error.set(result.error.message);
  }

  async exportConfigurations(): Promise<void> {
    const result = await this.session?.exportConfigurations();
    if (result && !result.ok) this.error.set(result.error.message);
  }

  /** A configuration table read from CSV, checked; `undefined` (with the error shown) when the file cannot be used. */
  readConfigurations(csv: string): ConfigurationImport | undefined {
    const result = this.session?.readConfigurations(csv);
    if (result && !result.ok) this.error.set(result.error.message);
    else this.error.set(undefined);
    return result?.ok ? result.value : undefined;
  }

  /** The model as one HTML file with a viewer, to share. */
  async exportViewer(): Promise<void> {
    const result = await this.session?.exportViewer();
    if (result && !result.ok) this.error.set(result.error.message);
  }

  /** Opens a side panel (or closes it with `undefined`), leaving sketches and dialogs. */
  openPanel(panel: SidePanel | undefined): void {
    const repair = this.repairing();
    if (repair && panel !== 'repair') {
      // Leaving a repair rolls the model forward to where it was.
      this.repairing.set(undefined);
      this.broken.set([]);
      void this.run({ type: 'roll-to', position: Math.min(repair.restore, this.state()?.document.timeline.length ?? 0) });
    }
    this.cancelDraft();
    this.finishEditing();
    this.pickedFace.set(undefined);
    this.measurePicks.set([]);
    this.focusedCheck.set(undefined);
    this.panel.set(panel);
  }

  /** Rolls the model back to just before the item and lists what it lost, to pick replacements. */
  async startRepair(itemId: string): Promise<void> {
    const document = this.state()?.document;
    if (!document || this.repairing()) return;
    const index = document.timeline.findIndex((i) => i.id === itemId);
    const restore = document.timeline.length - document.rollbackIndex;
    this.openPanel('repair');
    this.repairing.set({ itemId, restore });
    this.repairTarget.set(0);
    if (restore > index) await this.run({ type: 'roll-to', position: index });
    await this.loadBroken();
  }

  async replaceReference(from: TopologyRef, to: TopologyRef): Promise<void> {
    const repair = this.repairing();
    if (repair && (await this.run({ type: 'replace-reference', itemId: repair.itemId, from, to }))) await this.loadBroken();
  }

  private async loadBroken(): Promise<void> {
    const repair = this.repairing();
    const result = repair ? await this.session?.brokenReferences(repair.itemId) : undefined;
    this.broken.set(result?.ok ? result.value : []);
    this.repairTarget.set(0);
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

  /** Pictures shown behind sketches, by imported document: an object URL and the size in pixels. */
  readonly pictures = signal<ReadonlyMap<string, { readonly url: string; readonly width: number; readonly height: number }>>(new Map());
  private readonly loadingPictures = new Set<string>();

  /** Loads a picture to show behind a sketch (once). */
  async loadPicture(documentId: string): Promise<{ readonly url: string; readonly width: number; readonly height: number } | undefined> {
    const known = this.pictures().get(documentId);
    if (known || this.loadingPictures.has(documentId)) return known;
    this.loadingPictures.add(documentId);
    const preview = await this.projects.previewImported(documentId as DocumentId);
    if (!preview.ok || preview.value.kind !== 'picture') return undefined;
    const picture = { url: pictureUrl(preview.value.bytes, preview.value.mediaType), width: preview.value.width, height: preview.value.height };
    this.pictures.update((pictures) => new Map(pictures).set(documentId, picture));
    return picture;
  }

  /** Puts an imported picture behind the edited sketch, at 1/96 in a pixel, its bottom left at the origin. */
  async addPicture(documentId: DocumentId): Promise<void> {
    const sketchId = this.editing();
    const picture = await this.loadPicture(documentId);
    if (!sketchId || !picture) return;
    const [origin, handle, id] = [newId(), newId(), newId()];
    await this.run({
      type: 'add-sketch-geometry',
      sketchId,
      entities: [
        { id: origin, kind: 'point', x: 0, y: 0 },
        { id: handle, kind: 'point', x: (picture.width * 25.4) / 96, y: 0 },
        { id, kind: 'picture', document: documentId, origin, handle, opacity: 0.5, hidden: false },
      ],
      constraints: [],
    });
  }

  /** Adds an imported drawing to the edited sketch. */
  async insertDrawing(documentId: DocumentId, options?: InsertDrawingOptions): Promise<void> {
    const sketchId = this.editing();
    if (!sketchId || !this.session) return;
    const result = await this.session.insertDrawing(sketchId, documentId, `${newId()}-`, options);
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
