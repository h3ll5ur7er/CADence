import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { type DocumentSummary, isCurve, type Sketch, type SketchPlane } from '@core/contracts';
import { NameDialog } from '../../shared/dialogs';
import { relativeTime } from '../../shared/format';
import { Icon } from '../../shared/icon';
import { sketchDisplay } from '../../viewport/sketch-display';
import { Viewport } from '../../viewport/viewport';
import { EditorStatus } from '../editor-status';
import { DesignStore } from '../sketch/design-store';
import { SketchEditor } from '../sketch/sketch-editor';
import { SketchToolbar } from '../sketch/sketch-toolbar';

const planes: readonly { plane: SketchPlane; label: string }[] = [
  { plane: 'XY', label: 'XY plane (top)' },
  { plane: 'XZ', label: 'XZ plane (front)' },
  { plane: 'YZ', label: 'YZ plane (right)' },
];

const statusLabels = {
  'fully-constrained': 'Fully constrained',
  'under-constrained': 'Under-constrained',
  'over-constrained': 'Over-constrained',
  failed: 'Does not solve',
} as const;

/** Part modeling mode: sketches on origin planes now; features arrive in phase 3. */
@Component({
  selector: 'cad-component-mode',
  imports: [Viewport, Icon, SketchEditor, SketchToolbar, NameDialog],
  providers: [DesignStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './component-mode.html',
  styleUrls: ['./mode-layout.scss', './component-mode.scss'],
  host: {
    '(document:keydown)': 'shortcut($event)',
  },
})
export class ComponentMode {
  readonly document = input.required<DocumentSummary>();
  protected readonly status = inject(EditorStatus);
  protected readonly store = inject(DesignStore);
  protected readonly originVisible = signal(true);
  protected readonly planeMenu = signal(false);
  protected readonly planes = planes;
  protected readonly statusLabels = statusLabels;
  protected readonly relativeTime = relativeTime;
  private readonly nameDialog = viewChild.required(NameDialog);

  protected readonly timeline = computed(() => this.store.state()?.document.timeline ?? []);
  protected readonly displays = computed(() => {
    const state = this.store.state();
    if (!state) return [];
    const editing = this.store.editing();
    return [...state.sketches.values()].filter((v) => v.sketch.id !== editing).map((v) => sketchDisplay(v.sketch, v.profiles));
  });
  protected readonly editPlane = computed(() => this.store.editedView()?.sketch.plane);
  protected readonly editedSketch = computed(() => this.store.editedView());
  protected readonly counts = computed(() => {
    const sketch = this.editedSketch()?.sketch;
    return sketch && { curves: sketch.entities.filter(isCurve).length, constraints: sketch.constraints.length };
  });

  constructor() {
    effect(() => {
      const id = this.document().id;
      untracked(() => void this.store.open(id));
    });
  }

  protected async startSketch(plane: SketchPlane): Promise<void> {
    this.planeMenu.set(false);
    await this.store.createSketch(plane);
  }

  protected viewOf(sketch: Sketch) {
    return this.store.state()?.sketches.get(sketch.id);
  }

  protected async rename(sketch: Sketch): Promise<void> {
    const name = await this.nameDialog().ask({ heading: 'Rename sketch', confirmLabel: 'Rename', initial: sketch.name });
    if (name && name !== sketch.name) await this.store.run({ type: 'rename-item', itemId: sketch.id, name });
  }

  protected async remove(sketch: Sketch): Promise<void> {
    await this.store.run({ type: 'delete-item', itemId: sketch.id });
  }

  protected shortcut(event: KeyboardEvent): void {
    if ((event.target as HTMLElement | null)?.closest('input, textarea, dialog')) return;
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
