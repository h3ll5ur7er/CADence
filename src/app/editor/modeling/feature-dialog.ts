import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  type AxisRef,
  type BodyOperation,
  type Feature,
  isSketch,
  isToolFeature,
  type PlaneRef,
} from '@core/contracts';
import { Icon } from '../../shared/icon';
import { DesignStore } from '../sketch/design-store';
import { featureLabels, type PickTarget } from './feature-drafts';

const operations: readonly { value: BodyOperation; label: string }[] = [
  { value: 'new-body', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
];

const hints: Readonly<Record<Feature['type'], string>> = {
  extrude: 'Click profiles in the view to add or remove them.',
  revolve: 'Click profiles in the view; the axis can be a construction line of the sketch or an edge.',
  fillet: 'Click the edges to round.',
  chamfer: 'Click the edges to bevel.',
  shell: 'Click the faces to open; the walls keep the thickness.',
  plane: 'Offset from an origin plane, a construction plane or a flat face.',
  'linear-pattern': 'Repeats holes and bosses made by the selected features.',
  'circular-pattern': 'Repeats them around an axis; 360° spreads the copies evenly.',
  mirror: 'Mirrors them across a plane.',
};

/** Creates or edits one feature. Values are expressions; references are picked in the 3D view. */
@Component({
  selector: 'cad-feature-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './feature-dialog.html',
  styleUrl: './feature-dialog.scss',
})
export class FeatureDialog {
  protected readonly store = inject(DesignStore);
  protected readonly operations = operations;
  protected readonly draft = computed(() => this.store.draft());
  protected readonly feature = computed(() => this.draft()?.feature);
  protected readonly title = computed(() => {
    const draft = this.draft();
    return draft ? `${draft.mode === 'create' ? 'New' : 'Edit'} ${featureLabels[draft.feature.type].toLowerCase()}` : '';
  });
  protected readonly hint = computed(() => {
    const draft = this.draft();
    if (!draft) return '';
    if (draft.target === 'axis') return 'Click a straight edge in the view.';
    if (draft.target === 'plane') return 'Click a flat face in the view.';
    return hints[draft.feature.type];
  });

  /** Sketches that have profiles, for extrude and revolve. */
  protected readonly sketches = computed(() =>
    (this.store.state()?.document.timeline ?? []).filter(isSketch).filter((s) => (this.store.state()?.sketches.get(s.id)?.profiles.length ?? 0) > 0),
  );
  /** Construction lines of the chosen sketch, as revolve axes. */
  protected readonly axisLines = computed(() => {
    const f = this.feature();
    if (f?.type !== 'revolve') return [];
    const sketch = this.store.state()?.sketches.get(f.sketch)?.sketch;
    return (sketch?.entities ?? []).filter((e) => e.kind === 'line' && e.construction).map((e, i) => ({ id: e.id, label: `Construction line ${i + 1}` }));
  });
  /** Extrudes and revolves before this feature, for patterns and mirrors. */
  protected readonly tools = computed(() => {
    const f = this.feature();
    const timeline = this.store.state()?.document.timeline ?? [];
    const end = f ? timeline.findIndex((i) => i.id === f.id) : -1;
    return (end < 0 ? timeline : timeline.slice(0, end)).filter(isToolFeature);
  });
  protected readonly planeFeatures = computed(() =>
    (this.store.state()?.document.timeline ?? []).filter((i) => !isSketch(i) && i.type === 'plane' && i.id !== this.feature()?.id),
  );

  protected set(changes: Partial<Feature>, target?: PickTarget): void {
    const f = this.feature();
    if (f) this.store.updateDraft({ ...f, ...changes } as Feature, target);
  }

  protected axisValue(axis: AxisRef): string {
    return axis.kind === 'origin' ? `origin:${axis.axis}` : axis.kind === 'sketch-line' ? `line:${axis.line}` : 'edge';
  }

  /** Axis from a select value; "edge" waits for an edge to be picked. */
  protected setAxis(value: string, key: 'axis' | 'direction'): void {
    const f = this.feature();
    if (!f) return;
    if (value === 'edge') return this.set({}, 'axis');
    const axis: AxisRef = value.startsWith('origin:')
      ? { kind: 'origin', axis: value.slice(7) as 'X' | 'Y' | 'Z' }
      : { kind: 'sketch-line', sketch: f.type === 'revolve' ? f.sketch : '', line: value.slice(5) };
    this.set({ [key]: axis } as Partial<Feature>);
  }

  protected planeValue(plane: PlaneRef): string {
    return typeof plane === 'string' ? plane : 'plane' in plane ? `plane:${plane.plane}` : 'face';
  }

  /** Plane from a select value; "face" waits for a flat face to be picked. */
  protected setPlane(value: string, key: 'base' | 'plane'): void {
    if (value === 'face') return this.set({}, 'plane');
    const plane: PlaneRef = value.startsWith('plane:') ? { plane: value.slice(6) } : (value as 'XY' | 'XZ' | 'YZ');
    this.set({ [key]: plane } as Partial<Feature>);
  }

  protected toggleTool(id: string, on: boolean): void {
    const f = this.feature();
    if (f?.type !== 'linear-pattern' && f?.type !== 'circular-pattern' && f?.type !== 'mirror') return;
    this.set({ features: on ? [...f.features, id] : f.features.filter((x) => x !== id) });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
