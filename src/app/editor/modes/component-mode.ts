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
  type SketchText,
  type TimelineItem,
} from '@core/contracts';
import type { SolidFormat } from '@core/managers/design';
import { NameDialog } from '../../shared/dialogs';
import { CheckPanel } from '../analysis/check-panel';
import { MeasurePanel } from '../analysis/measure-panel';
import { grams, lengthIn, point, pointIn } from '../analysis/units';
import { relativeTime } from '../../shared/format';
import { Icon, type IconName } from '../../shared/icon';
import { Shortcuts } from '../../shared/shortcuts';
import { sketchDisplay } from '../../viewport/sketch-display';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';
import { bodyNames } from '../modeling/body-names';
import { featureLabels } from '../modeling/feature-drafts';
import { FeatureDialog } from '../modeling/feature-dialog';
import { ParametersPanel } from '../modeling/parameters-panel';
import { DesignStore } from '../sketch/design-store';
import { SketchEditor } from '../sketch/sketch-editor';
import { SketchToolbar } from '../sketch/sketch-toolbar';

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
      { type: 'hole', icon: 'hole' },
      { type: 'rib', icon: 'rib' },
      { type: 'thread', icon: 'thread' },
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
  'path-pattern': 'pathPattern',
  hole: 'hole',
  thread: 'thread',
  draft: 'draft',
  rib: 'rib',
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
  imports: [Viewport, Icon, SketchEditor, SketchToolbar, NameDialog, FeatureDialog, ParametersPanel, MeasurePanel, CheckPanel],
  providers: [DesignStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './component-mode.html',
  styleUrls: ['./mode-layout.scss', './editor-tools.scss', './component-mode.scss'],
})
export class ComponentMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  private readonly unitsInStatus = effect(() => this.status.units.set(this.store.units()));

  protected setUnits(units: LengthUnit): void {
    void this.store.run({ type: 'set-units', units });
  }
  protected readonly store = inject(DesignStore);
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
  protected readonly point = point;
  private readonly nameDialog = viewChild.required(NameDialog);

  protected readonly timeline = computed(() => this.store.state()?.document.timeline ?? []);
  protected readonly displays = computed(() => {
    const state = this.store.state();
    if (!state) return [];
    const editing = this.store.editing();
    return [...state.sketches.values()]
      .filter((v) => v.sketch.id !== editing && !v.error && state.items.get(v.sketch.id)?.state === 'ok')
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
    params: () => ({ bodies: this.bodies().map((b) => b.key).join(','), density: this.material().density }),
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
    void this.store.run({ type: 'set-appearance', body, appearance: this.appearances()[body]?.hidden ? { hidden: true } : {} });
  }

  protected readonly pi = Math.PI;
  protected readonly round = (v: number) => Math.round(v * 100) / 100;
  /** The one text selected in the sketch being edited, for its properties. */
  protected readonly selectedText = computed(() => {
    const selection = this.store.selection();
    const sketch = this.editedSketch()?.sketch;
    const found = selection.length === 1 ? sketch?.entities.find((e) => e.id === selection[0]) : undefined;
    // Texts of a drawing kept as one piece come from the drawing: they cannot be edited on their own.
    return found?.kind === 'text' && sketch && !generatorOf(sketch, found.id) ? found : undefined;
  });

  protected setText(text: SketchText, change: Partial<Pick<SketchText, 'text' | 'height' | 'weight' | 'angle'>>): void {
    const sketchId = this.store.editing();
    if (!sketchId) return;
    const next = { ...text, ...change };
    void this.store.run({ type: 'set-sketch-text', sketchId, textId: text.id, text: next.text, height: next.height, weight: next.weight, angle: next.angle });
  }

  /** Changes how a body is shown; one undoable step. */
  protected setAppearance(body: string, change: Partial<Appearance>): void {
    const { hidden, ...look } = { ...this.appearances()[body], ...change };
    void this.store.run({ type: 'set-appearance', body, appearance: hidden ? { ...look, hidden } : look });
  }

  protected setMaterial(name: string): void {
    const material = materials.find((m) => m.name === name);
    if (material) void this.store.run({ type: 'set-material', material });
  }

  protected togglePanel(panel: 'measure' | 'check'): void {
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
  /** The timeline item (or `marker`) being dragged. */
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

  /** Moves the marker or an item to a slot between items (0 … length). */
  private async moveTo(what: string, slot: number): Promise<void> {
    if (what === 'marker') {
      if (slot !== this.marker()) await this.store.run({ type: 'roll-to', position: slot });
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
