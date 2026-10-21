import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  type Appearance,
  type Finish,
  finishes,
  type DocumentSummary,
  type FeatureType,
  type LengthUnit,
  lengthUnitNames,
  generatorOf,
  isCurve,
  isSketch,
  type Material,
  type MeshQuality,
  materials,
  type PlaneRef,
  type Dimension,
  isDimension,
  type SketchInsertion,
  type SketchText,
  type TextPath,
  folderItems,
  nestFolders,
  type PlacedFolder,
  type TimelineFolder,
  type TimelineItem,
} from '@core/contracts';
import { newId } from '@core/utilities/identity';
import type { SolidFormat } from '@core/managers/design';
import { NameDialog } from '../../shared/dialogs';
import { CheckPanel } from '../analysis/check-panel';
import { MeasurePanel } from '../analysis/measure-panel';
import { SimulatePanel } from '../analysis/simulate-panel';
import { grams, lengthIn, point, pointIn } from '../analysis/units';
import { relativeTime } from '../../shared/format';
import { Icon, type IconName } from '../../shared/icon';
import { Shortcuts } from '../../shared/shortcuts';
import { sketchDisplay } from '../../viewport/sketch-display';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';
import { ThumbnailSaver } from '../thumbnail-saver';
import { bodyNames } from '../modeling/body-names';
import { featureLabels } from '../modeling/feature-drafts';
import { FeatureDialog } from '../modeling/feature-dialog';
import { ParametersPanel } from '../modeling/parameters-panel';
import { FolderDialog, NoteDialog } from '../modeling/timeline-dialogs';
import { PictureDialog } from '../picture-dialog';
import { RepairPanel } from '../modeling/repair-panel';
import { DesignStore } from '../sketch/design-store';
import { describeConstraint } from '../sketch/sketch-overlay';
import { googleFont, SYSTEM_FONTS } from '../../shared/fonts';
import { SketchEditor } from '../sketch/sketch-editor';
import { SketchToolbar } from '../sketch/sketch-toolbar';
import { ChangedElsewhereNotice } from '../changed-elsewhere';

const statusLabels = {
  'fully-constrained': 'Fully constrained',
  'under-constrained': 'Under-constrained',
  'over-constrained': 'Over-constrained',
  failed: 'Does not solve',
} as const;

const featureTools: readonly { type: FeatureType; icon: IconName }[] = [
  { type: 'extrude', icon: 'extrude' },
  { type: 'revolve', icon: 'revolve' },
  { type: 'fillet', icon: 'fillet' },
  { type: 'chamfer', icon: 'chamfer' },
  { type: 'shell', icon: 'shell' },
  { type: 'draft', icon: 'draft' },
  { type: 'plane', icon: 'planeAdd' },
];

/** Less frequent features, in menus of the model toolbar. */
const featureMenus: readonly { id: string; label: string; icon: IconName; items: readonly { type: FeatureType; icon: IconName }[] }[] = [
  {
    id: 'create',
    label: 'Create',
    icon: 'create',
    items: [
      { type: 'loft', icon: 'loft' },
      { type: 'sweep', icon: 'sweep' },
      { type: 'helix', icon: 'helix' },
      { type: 'hole', icon: 'hole' },
      { type: 'part', icon: 'part' },
      { type: 'rib', icon: 'rib' },
      { type: 'wrap', icon: 'wrap' },
      { type: 'thread', icon: 'thread' },
      { type: 'base-flange', icon: 'sheet' },
      { type: 'edge-flange', icon: 'flange' },
      { type: 'insert', icon: 'imported' },
    ],
  },
  {
    id: 'pattern',
    label: 'Pattern',
    icon: 'pattern',
    items: [
      { type: 'linear-pattern', icon: 'pattern' },
      { type: 'circular-pattern', icon: 'circular' },
      { type: 'path-pattern', icon: 'pathPattern' },
      { type: 'mirror', icon: 'mirror' },
    ],
  },
  {
    id: 'bodies',
    label: 'Bodies',
    icon: 'body',
    items: [
      { type: 'combine', icon: 'combine' },
      { type: 'split', icon: 'split' },
      { type: 'move', icon: 'move' },
      { type: 'scale', icon: 'scale' },
    ],
  },
];

const itemIcons: Readonly<Record<TimelineItem['type'], IconName>> = {
  part: 'part',
  insert: 'imported',
  sketch: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  fillet: 'fillet',
  chamfer: 'chamfer',
  shell: 'shell',
  plane: 'planeAdd',
  'linear-pattern': 'pattern',
  'circular-pattern': 'circular',
  mirror: 'mirror',
  combine: 'combine',
  split: 'split',
  move: 'move',
  scale: 'scale',
  loft: 'loft',
  sweep: 'sweep',
  helix: 'helix',
  'path-pattern': 'pathPattern',
  hole: 'hole',
  thread: 'thread',
  draft: 'draft',
  rib: 'rib',
  wrap: 'wrap',
  'base-flange': 'sheet',
  'edge-flange': 'flange',
};

const exportFormats: readonly { format: SolidFormat; label: string }[] = [
  { format: 'step', label: 'STEP (exact, for CAD)' },
  { format: 'stl', label: 'STL (for slicers)' },
  { format: '3mf', label: '3MF (for slicers)' },
  { format: 'obj', label: 'OBJ (mesh)' },
];

/** Part modeling mode: sketches, features, parameters and bodies. */
@Component({
  selector: 'cad-component-mode',
  imports: [ChangedElsewhereNotice, Viewport, PictureDialog, Icon, SketchEditor, SketchToolbar, NameDialog, FolderDialog, NoteDialog, FeatureDialog, ParametersPanel, MeasurePanel, CheckPanel, SimulatePanel, RepairPanel],
  providers: [DesignStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './component-mode.html',
  styleUrls: ['./mode-layout.scss', './editor-tools.scss', './component-mode.scss'],
})
export class ComponentMode {
  /** Opens the document again, with what another program changed (CAD-150). */
  protected reopen(): void {
    const { id, projectId } = this.document();
    void this.store.open(id, projectId);
  }

  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly thumbnails = inject(ThumbnailSaver);
  private readonly unitsInStatus = effect(() => this.status.units.set(this.store.units()));

  protected setUnits(units: LengthUnit): void {
    void this.store.run({ type: 'set-units', units });
  }
  protected readonly store = inject(DesignStore);
  /** The relations and dimensions a refused sketch change conflicts with, in words. */
  protected readonly conflicts = computed(() => {
    const conflict = this.store.conflict();
    const sketch = this.store.state()?.sketches.get(conflict?.sketchId ?? '')?.sketch;
    return (conflict?.constraints ?? []).flatMap((id) => {
      const constraint = sketch?.constraints.find((c) => c.id === id);
      return constraint ? [{ id, label: describeConstraint(constraint) }] : [];
    });
  });
  protected readonly originVisible = signal(true);
  /** The open toolbar menu: sketch, export, or one of the feature menus. */
  protected readonly menu = signal<string | undefined>(undefined);
  protected readonly statusLabels = statusLabels;
  protected readonly featureTools = featureTools;
  protected readonly featureMenus = featureMenus;
  protected readonly featureLabels = featureLabels;
  protected readonly itemIcons = itemIcons;
  protected readonly exportFormats = exportFormats;
  protected readonly relativeTime = relativeTime;
  protected readonly materials = materials;
  protected readonly mm = (value: number, power: 1 | 2 | 3 = 1) => lengthIn(this.store.units(), value, power);
  protected readonly at = (p: readonly number[]) => pointIn(this.store.units(), p);
  protected readonly unitNames = lengthUnitNames;
  protected readonly unitList = Object.keys(lengthUnitNames) as LengthUnit[];
  protected readonly grams = grams;
  /** A spring's rate (or turns) to three significant digits. */
  protected readonly rate = (value: number) => Number(value.toPrecision(3)).toString();
  protected readonly finishes = finishes;
  protected readonly finishLabels: Readonly<Record<Finish, string>> = { matte: 'Matte', plastic: 'Plastic', metal: 'Metal', glass: 'Glass', wood: 'Wood' };
  protected readonly point = point;
  private readonly nameDialog = viewChild.required(NameDialog);
  protected readonly pictureDialog = viewChild.required(PictureDialog);
  protected readonly isSketch = isSketch;
  private readonly folderDialog = viewChild.required(FolderDialog);
  private readonly noteDialog = viewChild.required(NoteDialog);

  protected readonly timeline = computed(() => this.store.state()?.document.timeline ?? []);
  protected readonly displays = computed(() => {
    const state = this.store.state();
    if (!state) return [];
    const editing = this.store.editing();
    // Blocks are placed by other sketches; they are not drawn in the model themselves.
    return [...state.sketches.values()]
      .filter((v) => v.sketch.id !== editing && !v.sketch.block && !v.error && state.items.get(v.sketch.id)?.state === 'ok')
      .map((v) => sketchDisplay(v.sketch, v.profiles, v.frame, v.texts));
  });
  protected readonly planeFrames = computed(() => [...(this.store.state()?.planes.values() ?? [])]);
  protected readonly planeFeatures = computed(() => this.timeline().filter((i) => !isSketch(i) && i.type === 'plane'));
  protected readonly bodies = computed(() => this.store.state()?.bodies ?? []);
  protected readonly editPlane = computed(() => this.store.editedView()?.frame);
  protected readonly editedSketch = computed(() => this.store.editedView());
  protected readonly counts = computed(() => {
    const sketch = this.editedSketch()?.sketch;
    return sketch && { curves: sketch.entities.filter(isCurve).length, constraints: sketch.constraints.length };
  });
  protected readonly material = computed(() => this.store.state()?.document.material ?? (materials[0] as Material));
  protected readonly properties = resource({
    params: () => ({ bodies: this.bodies().map((b) => b.key).join(','), density: this.material().density, own: this.store.state()?.document.bodyMaterials }),
    loader: () => this.store.properties(),
  });
  protected readonly bodyRows = computed(() => {
    const properties = this.properties.value() ?? [];
    const names = bodyNames(this.bodies().map((b) => b.body), this.timeline());
    const appearances = this.appearances();
    return this.bodies().map((b) => ({
      id: b.body,
      name: names.get(b.body) ?? b.body,
      properties: properties.find((p) => p.body === b.body),
      appearance: appearances[b.body] ?? {},
      material: this.store.state()?.document.bodyMaterials?.[b.body],
    }));
  });
  /** How bodies are shown, from the document. */
  protected readonly appearances = computed(() => this.store.state()?.document.appearances ?? {});
  /** The theme's body colour, for colour fields of bodies that have none of their own. */
  protected readonly defaultColor = getComputedStyle(document.documentElement).getPropertyValue('--body').trim() || '#a9b6c2';
  /** The measured distance, drawn in the view. */
  protected readonly measureLine = computed(() => {
    const result = this.store.panel() === 'measure' ? this.store.measurement.value() : undefined;
    return result?.ok ? result.value.points : undefined;
  });

  constructor() {
    effect(() => {
      const { id, projectId } = this.document();
      untracked(() => void this.store.open(id, projectId));
    });
    const shortcuts = inject(Shortcuts);
    const feature = (type: FeatureType) => () => this.store.startFeature(type);
    const stops = [
      shortcuts.register('document', {
        undo: () => void this.store.undo(),
        redo: () => void this.store.redo(),
        cancel: () => (this.store.draft() ? this.store.cancelDraft() : this.menu.set(undefined)),
      }),
      shortcuts.registerActions([
        ...featureMenus.flatMap((menu) => menu.items.map((item) => ({ label: featureLabels[item.type], group: menu.label, run: () => this.startFeature(item.type) }))),
        { label: 'Check manufacturability', group: 'Inspect', run: () => this.togglePanel('check') },
        { label: 'Check strength (simulate loads)', group: 'Inspect', run: () => this.togglePanel('simulate') },
        { label: 'New folder in the timeline', group: 'Timeline', run: () => void this.newFolder() },
        { label: 'Export configurations as CSV', group: 'Parameters', run: () => void this.store.exportConfigurations() },
        ...exportFormats.map((f) => ({ label: `Export ${f.label}`, group: 'Export', run: () => void this.store.exportBodies(f.format) })),
        { label: 'Export a viewer (HTML)', group: 'Export', run: () => void this.store.exportViewer() },
      ]),
      shortcuts.register('modeling', {
        'new-sketch': () => this.menu.set('sketch'),
        extrude: feature('extrude'),
        revolve: feature('revolve'),
        fillet: feature('fillet'),
        chamfer: feature('chamfer'),
        shell: feature('shell'),
        plane: feature('plane'),
        measure: () => this.togglePanel('measure'),
        parameters: () => this.store.openPanel('parameters'),
      }),
    ];
    inject(DestroyRef).onDestroy(() => stops.forEach((stop) => stop()));
  }

  /** Back to the theme's colour, opaque; a hidden body stays hidden. */
  protected resetLook(body: string): void {
    this.look(body, this.lookOf(body)?.hidden ? { hidden: true } : {});
  }

  protected readonly pi = Math.PI;
  protected readonly round = (v: number) => Math.round(v * 100) / 100;
  /** The one text selected in the sketch being edited, for its properties. */
  /** The one dimension selected in the edited sketch. */
  protected readonly selectedDimension = computed(() => {
    const selection = this.store.selection();
    const view = this.editedSketch();
    const found = selection.length === 1 ? view?.sketch.constraints.find((c) => c.id === selection[0]) : undefined;
    return found && isDimension(found) ? { dimension: found, value: view?.values.get(found.id) } : undefined;
  });

  /** A dimension's value as shown: lengths in the component's unit, angles in degrees. */
  protected dimensionValue(selected: { dimension: Dimension; value: number | undefined }): string {
    if (selected.value === undefined) return '—';
    return selected.dimension.kind === 'angle' ? `${this.round((selected.value * 180) / Math.PI)}°` : this.mm(selected.value);
  }

  protected setReference(dimension: Dimension, reference: boolean, name?: string): void {
    const sketchId = this.store.editing();
    if (!sketchId) return;
    const named = name?.trim();
    void this.store.run({ type: 'set-dimension-reference', sketchId, constraintId: dimension.id, reference, ...(named ? { name: named } : {}) });
  }

  /** The placed block selected (or a piece of it) in the edited sketch, with the name of its block. */
  protected readonly selectedBlock = computed(() => {
    const selection = this.store.selection();
    const sketch = this.editedSketch()?.sketch;
    if (!sketch || selection.length !== 1) return undefined;
    const id = selection[0] as string;
    const owner = generatorOf(sketch, id);
    const found = owner?.kind === 'block' ? owner : sketch.entities.find((e) => e.id === id);
    if (found?.kind !== 'block') return undefined;
    const own = found.document ? undefined : this.timeline().find((i) => i.id === found.block);
    return { insertion: found, name: own?.name ?? 'A block of another component', editable: !!own };
  });

  protected setBlock(insertion: SketchInsertion, change: { angle?: string; scale?: string }): void {
    const sketchId = this.store.editing();
    if (!sketchId) return;
    void this.store.run({ type: 'set-block', sketchId, insertion: insertion.id, angle: change.angle ?? insertion.angle, scale: change.scale ?? insertion.scale });
  }

  protected explodeBlock(insertion: SketchInsertion): void {
    const sketchId = this.store.editing();
    if (sketchId) void this.store.run({ type: 'explode-block', sketchId, insertion: insertion.id });
  }

  /** Opens the block sketch to edit it: every placement follows. */
  protected editBlock(insertion: SketchInsertion): void {
    this.store.edit(insertion.block);
  }

  protected setSketchBlock(sketchId: string, block: boolean): void {
    void this.store.run({ type: 'set-sketch-block', sketchId, block });
  }

  protected readonly selectedText = computed(() => {
    const selection = this.store.selection();
    const sketch = this.editedSketch()?.sketch;
    const found = selection.length === 1 ? sketch?.entities.find((e) => e.id === selection[0]) : undefined;
    // Texts of a drawing kept as one piece come from the drawing: they cannot be edited on their own.
    return found?.kind === 'text' && sketch && !generatorOf(sketch, found.id) ? found : undefined;
  });

  protected setText(text: SketchText, change: Partial<Pick<SketchText, 'text' | 'height' | 'weight' | 'angle'>> & { font?: string | null; along?: TextPath | null }): void {
    const sketchId = this.store.editing();
    if (!sketchId) return;
    const next = { ...text, ...change };
    const font = next.font ?? undefined;
    const along = next.along ?? undefined;
    void this.store.run({
      type: 'set-sketch-text',
      sketchId,
      textId: text.id,
      text: next.text,
      height: next.height,
      weight: next.weight,
      angle: next.angle,
      ...(font ? { font } : {}),
      ...(along ? { along } : {}),
    });
  }

  /** Fonts on this computer (desktop only). */
  protected readonly systemFonts = inject(SYSTEM_FONTS);
  /** Where a new font for the selected text comes from, while one is being chosen. */
  protected readonly fontSource = signal<'google' | 'system' | undefined>(undefined);
  protected readonly fontFilter = signal('');
  private readonly systemFontList = resource({
    params: () => (this.fontSource() === 'system' ? true : undefined),
    loader: () => this.systemFonts?.list() ?? Promise.resolve([]),
  });
  protected readonly systemFontMatches = computed(() => {
    const find = this.fontFilter().trim().toLowerCase();
    return (this.systemFontList.value() ?? []).filter((name) => name.toLowerCase().includes(find)).slice(0, 40);
  });

  protected chooseFont(text: SketchText, value: string): void {
    if (value === 'google' || value === 'system') return this.fontSource.set(value);
    this.fontSource.set(undefined);
    this.setText(text, { font: value || null });
  }

  protected async getGoogleFont(text: SketchText, family: string, bold: boolean): Promise<void> {
    if (!family.trim()) return;
    try {
      const document = await this.store.importFont(await googleFont(family, bold));
      if (document) this.setText(text, { font: document.id });
      this.fontSource.set(undefined);
    } catch (error) {
      this.store.error.set((error as Error).message);
    }
  }

  protected async pickSystemFont(text: SketchText, name: string): Promise<void> {
    if (!this.systemFonts) return;
    const document = await this.store.importFont(await this.systemFonts.read(name));
    if (document) this.setText(text, { font: document.id });
    this.fontSource.set(undefined);
  }

  /** The curves of the edited sketch a text can follow. */
  protected readonly textCurves = computed(() => {
    const sketch = this.editedSketch()?.sketch;
    const counts = new Map<string, number>();
    const names: Record<string, string> = { line: 'Line', arc: 'Arc', circle: 'Circle', ellipse: 'Ellipse', spline: 'Spline' };
    return (sketch?.entities ?? []).filter(isCurve).map((curve) => {
      const n = (counts.get(curve.kind) ?? 0) + 1;
      counts.set(curve.kind, n);
      return { id: curve.id, label: `${names[curve.kind] ?? curve.kind} ${n}` };
    });
  });

  protected setAlong(text: SketchText, curve: string): void {
    this.setText(text, { along: curve ? { curve, offset: 0, reversed: false } : null });
  }

  /** Changes how a body is shown; one undoable step. */
  protected setAppearance(body: string, change: Partial<Appearance>): void {
    const { hidden, ...look } = { ...this.lookOf(body), ...change };
    this.look(body, hidden ? { ...look, hidden } : look);
  }

  /** Looks sent but not applied yet, by body: a change made meanwhile builds on them, not on the older look. */
  private readonly sentLooks = new Map<string, Appearance>();

  private lookOf(body: string): Appearance | undefined {
    return this.sentLooks.get(body) ?? this.appearances()[body];
  }

  private look(body: string, appearance: Appearance): void {
    this.sentLooks.set(body, appearance);
    void this.store.run({ type: 'set-appearance', body, appearance }).finally(() => {
      if (this.sentLooks.get(body) === appearance) this.sentLooks.delete(body);
    });
  }

  protected setMaterial(name: string): void {
    const material = materials.find((m) => m.name === name);
    if (material) void this.store.run({ type: 'set-material', material });
  }

  /** A body's own material, or the component's again (an empty name) (CAD-158). */
  protected setBodyMaterial(body: string, name: string): void {
    const material = materials.find((m) => m.name === name);
    void this.store.run({ type: 'set-body-material', body, ...(material ? { material } : {}) });
  }

  protected togglePanel(panel: 'measure' | 'check' | 'simulate'): void {
    this.store.openPanel(this.store.panel() === panel ? undefined : panel);
  }

  protected startFeature(type: FeatureType): void {
    this.menu.set(undefined);
    this.store.startFeature(type);
  }

  protected toggleMenu(menu: string): void {
    this.menu.set(this.menu() === menu ? undefined : menu);
  }

  protected async startSketch(plane: PlaneRef): Promise<void> {
    this.menu.set(undefined);
    await this.store.createSketch(plane);
    this.store.pickedFace.set(undefined);
  }

  protected sketchOnPickedFace(): void {
    const face = this.store.pickedFace();
    if (face?.planar) void this.startSketch({ face: { kind: 'face', body: face.body, name: face.name, hint: face.hint } });
  }

  protected exportAs(format: SolidFormat): void {
    this.menu.set(undefined);
    void this.store.exportBodies(format);
  }

  /** The export form: one format, the bodies to include and the mesh quality. */
  protected exportFlat(format: 'dxf' | 'svg'): void {
    this.menu.set(undefined);
    void this.store.exportFlatPattern(format);
  }

  protected readonly exportDraft = signal<{ format: SolidFormat; bodies: readonly string[]; quality: MeshQuality; configuration: string } | undefined>(undefined);

  protected openExport(): void {
    this.menu.set(undefined);
    this.exportDraft.set({ format: 'stl', bodies: this.bodies().map((b) => b.body), quality: 'normal', configuration: this.store.state()?.document.configuration ?? '' });
  }

  protected changeExport(changes: Partial<{ format: SolidFormat; quality: MeshQuality; configuration: string }>): void {
    const draft = this.exportDraft();
    if (draft) this.exportDraft.set({ ...draft, ...changes });
  }

  protected toggleExportBody(id: string, on: boolean): void {
    const draft = this.exportDraft();
    if (draft) this.exportDraft.set({ ...draft, bodies: on ? [...draft.bodies, id] : draft.bodies.filter((b) => b !== id) });
  }

  protected async exportWithOptions(): Promise<void> {
    const draft = this.exportDraft();
    if (!draft) return;
    this.exportDraft.set(undefined);
    await this.store.exportBodies(draft.format, { bodies: draft.bodies, quality: draft.quality, configuration: draft.configuration });
  }

  /** The number of items before the rollback marker. */
  protected readonly marker = computed(() => this.timeline().length - (this.store.state()?.document.rollbackIndex ?? 0));
  /** The timeline item (or `marker`, or `folder:<id>`) being dragged. */
  protected readonly dragging = signal<string | undefined>(undefined);

  protected startDrag(event: DragEvent, what: string): void {
    this.dragging.set(what);
    event.dataTransfer?.setData('text/plain', what);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  /** A drop on the item at `index`: before it on its upper half, after it on its lower half. */
  protected drop(event: DragEvent, index: number): void {
    event.preventDefault();
    const what = this.dragging();
    this.dragging.set(undefined);
    if (!what) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const slot = event.clientY < box.top + box.height / 2 ? index : index + 1;
    void this.moveTo(what, slot);
  }

  /** A drop on a folder's row: before the folder. */
  protected dropAt(event: DragEvent, slot: number): void {
    event.preventDefault();
    const what = this.dragging();
    this.dragging.set(undefined);
    if (what) void this.moveTo(what, slot);
  }

  /** Moves the marker, an item or a folder to a slot between items (0 … length). */
  private async moveTo(what: string, slot: number): Promise<void> {
    if (what === 'marker') {
      if (slot !== this.marker()) await this.store.run({ type: 'roll-to', position: slot });
      return;
    }
    if (what.startsWith('folder:')) {
      const placed = this.placedFolders().find((f) => f.folder.id === what.slice('folder:'.length));
      if (!placed || slot < 0 || slot > this.timeline().length || (slot >= placed.from && slot <= placed.to + 1)) return;
      const index = slot > placed.to ? slot - (placed.to - placed.from + 1) : slot;
      await this.store.run({ type: 'move-folder', folderId: placed.folder.id, index });
      return;
    }
    const from = this.timeline().findIndex((i) => i.id === what);
    if (from < 0) return;
    const index = from < slot ? slot - 1 : slot;
    if (index !== from) await this.store.run({ type: 'reorder-item', itemId: what, index });
  }

  protected markerKey(event: KeyboardEvent): void {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const position = this.marker() + step;
    if (position >= 0 && position <= this.timeline().length) void this.store.run({ type: 'roll-to', position });
  }

  /** Alt+arrow keys move an item up or down the timeline. */
  protected itemKey(event: KeyboardEvent, item: TimelineItem, index: number): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    void this.moveTo(item.id, event.key === 'ArrowUp' ? index - 1 : index + 2);
  }

  protected async open(item: TimelineItem, index: number): Promise<void> {
    // A rolled-back item is edited with the model as it was there: roll forward to just after it.
    if (index >= this.marker() && !(await this.store.run({ type: 'roll-to', position: index + 1 }))) return;
    if (isSketch(item)) {
      this.store.cancelDraft();
      this.store.edit(item.id);
    } else {
      this.store.editFeature(item.id);
    }
  }

  protected statusOf(item: TimelineItem) {
    return this.store.state()?.items.get(item.id);
  }

  protected sketchStatus(item: TimelineItem): keyof typeof statusLabels | undefined {
    return isSketch(item) ? this.store.state()?.sketches.get(item.id)?.status : undefined;
  }

  protected readonly folders = computed(() => this.store.state()?.document.folders ?? []);
  /** The folders where they are, outer ones first, each with the one it is in (CAD-157). */
  protected readonly placedFolders = computed(() => nestFolders(this.folders(), this.timeline()));
  /** The folders each timeline item is in, outermost first. */
  protected readonly folderOf = computed(() => {
    const holding = new Map<string, PlacedFolder[]>();
    for (const placed of this.placedFolders()) for (const id of folderItems(placed.folder, this.timeline())) holding.set(id, [...(holding.get(id) ?? []), placed]);
    return holding;
  });
  /** Folders shown closed (not stored: how the timeline is looked at, not what it is). */
  protected readonly collapsed = signal<ReadonlySet<string>>(new Set());

  /** The folders whose first item this is, outer ones first. */
  protected foldersStartingAt(item: TimelineItem): PlacedFolder[] {
    return this.placedFolders().filter((f) => f.folder.first === item.id);
  }

  /** How many folders an item is in, for its indent. */
  protected depthOf(item: TimelineItem): number {
    return this.folderOf().get(item.id)?.length ?? 0;
  }

  protected inClosedFolder(item: TimelineItem): boolean {
    return (this.folderOf().get(item.id) ?? []).some((f) => this.collapsed().has(f.folder.id));
  }

  /** Whether a folder's row is hidden: a folder holding it is closed. */
  protected folderHidden(placed: PlacedFolder): boolean {
    const byId = new Map(this.placedFolders().map((f) => [f.folder.id, f]));
    for (let parent = placed.parent; parent; parent = byId.get(parent)?.parent) if (this.collapsed().has(parent)) return true;
    return false;
  }

  /** Alt+arrow keys move a folder, with what it holds, past the item above or below it. */
  protected folderKey(event: KeyboardEvent, placed: PlacedFolder): void {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    void this.moveTo(`folder:${placed.folder.id}`, event.key === 'ArrowUp' ? placed.from - 1 : placed.to + 2);
  }

  protected toggleFolder(folder: TimelineFolder): void {
    this.collapsed.update((open) => {
      const next = new Set(open);
      if (!next.delete(folder.id)) next.add(folder.id);
      return next;
    });
  }

  /** Whether every item of the folder is suppressed. */
  protected folderSuppressed(folder: TimelineFolder): boolean {
    const ids = new Set(folderItems(folder, this.timeline()));
    return this.timeline().filter((i) => ids.has(i.id)).every((i) => i.suppressed);
  }

  protected suppressFolder(folder: TimelineFolder): void {
    void this.store.run({ type: 'suppress-folder', folderId: folder.id, suppressed: !this.folderSuppressed(folder) });
  }

  /** Rolls the model back to the end of the folder: what it holds and everything before. */
  protected rollToFolder(folder: TimelineFolder): void {
    void this.store.run({ type: 'roll-to', position: this.timeline().findIndex((i) => i.id === folder.last) + 1 });
  }

  protected async newFolder(): Promise<void> {
    // Starts with the latest item before the marker that is in no folder.
    const free = this.timeline().slice(0, Math.max(1, this.marker())).filter((i) => !this.folderOf().has(i.id));
    const item = free.at(-1) ?? this.timeline()[0];
    if (!item) return;
    const folder = await this.folderDialog().ask({ heading: 'New folder', folder: { id: newId(), name: '', first: item.id, last: item.id }, items: this.timeline() });
    if (folder) await this.store.run({ type: 'set-folder', folder });
  }

  protected async editFolder(folder: TimelineFolder): Promise<void> {
    const changed = await this.folderDialog().ask({ heading: `Edit ${folder.name}`, folder, items: this.timeline() });
    if (changed) await this.store.run({ type: 'set-folder', folder: changed });
  }

  protected removeFolder(folder: TimelineFolder): void {
    void this.store.run({ type: 'delete-folder', folderId: folder.id });
  }

  protected async editNote(item: TimelineItem): Promise<void> {
    const note = await this.noteDialog().ask(item.name, item.note ?? '');
    if (note !== undefined && note.trim() !== (item.note ?? '')) await this.store.run({ type: 'set-note', itemId: item.id, note });
  }

  protected async rename(item: TimelineItem): Promise<void> {
    const name = await this.nameDialog().ask({ heading: 'Rename', confirmLabel: 'Rename', initial: item.name });
    if (name && name !== item.name) await this.store.run({ type: 'rename-item', itemId: item.id, name });
  }

  protected async remove(item: TimelineItem): Promise<void> {
    if (this.store.editing() === item.id) this.store.finishEditing();
    await this.store.run({ type: 'delete-item', itemId: item.id });
  }

  protected suppress(item: TimelineItem): void {
    void this.store.run({ type: 'suppress-item', itemId: item.id, suppressed: !item.suppressed });
  }

}
