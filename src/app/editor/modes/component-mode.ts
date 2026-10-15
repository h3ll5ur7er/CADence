import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  type DocumentSummary,
  type FeatureType,
  isCurve,
  isSketch,
  type Material,
  materials,
  type PlaneRef,
  type TimelineItem,
} from '@core/contracts';
import type { SolidFormat } from '@core/managers/design';
import { NameDialog } from '../../shared/dialogs';
import { CheckPanel } from '../analysis/check-panel';
import { MeasurePanel } from '../analysis/measure-panel';
import { grams, millimetres, point } from '../analysis/units';
import { relativeTime } from '../../shared/format';
import { Icon, type IconName } from '../../shared/icon';
import { sketchDisplay } from '../../viewport/sketch-display';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';
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
  { type: 'plane', icon: 'planeAdd' },
  { type: 'linear-pattern', icon: 'pattern' },
  { type: 'circular-pattern', icon: 'circular' },
  { type: 'mirror', icon: 'mirror' },
];

const itemIcons: Readonly<Record<TimelineItem['type'], IconName>> = {
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
  host: {
    '(document:keydown)': 'shortcut($event)',
  },
})
export class ComponentMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly store = inject(DesignStore);
  protected readonly originVisible = signal(true);
  protected readonly menu = signal<'sketch' | 'export' | undefined>(undefined);
  protected readonly statusLabels = statusLabels;
  protected readonly featureTools = featureTools;
  protected readonly featureLabels = featureLabels;
  protected readonly itemIcons = itemIcons;
  protected readonly exportFormats = exportFormats;
  protected readonly relativeTime = relativeTime;
  protected readonly materials = materials;
  protected readonly mm = millimetres;
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
      .map((v) => sketchDisplay(v.sketch, v.profiles, v.frame));
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
    return this.bodies().map((b) => ({
      id: b.body,
      name: this.timeline().find((i) => i.id === b.body)?.name ?? b.body,
      properties: properties.find((p) => p.body === b.body),
    }));
  });
  /** The measured distance, drawn in the view. */
  protected readonly measureLine = computed(() => {
    const result = this.store.panel() === 'measure' ? this.store.measurement.value() : undefined;
    return result?.ok ? result.value.points : undefined;
  });

  constructor() {
    effect(() => {
      const id = this.document().id;
      untracked(() => void this.store.open(id));
    });
  }

  protected setMaterial(name: string): void {
    const material = materials.find((m) => m.name === name);
    if (material) void this.store.run({ type: 'set-material', material });
  }

  protected togglePanel(panel: 'measure' | 'check'): void {
    this.store.openPanel(this.store.panel() === panel ? undefined : panel);
  }

  protected toggleMenu(menu: 'sketch' | 'export'): void {
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

  protected open(item: TimelineItem): void {
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

  protected shortcut(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest('input, textarea, select, dialog')) return;
    if (event.key === 'Escape' && this.store.draft()) {
      this.store.cancelDraft();
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      void this.store.undo();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      void this.store.redo();
    }
  }
}
