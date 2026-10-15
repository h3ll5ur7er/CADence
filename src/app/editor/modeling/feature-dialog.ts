import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
  type AxisRef,
  type BodyOperation,
  type Feature,
  isSketch,
  isRepeatable,
  isToolFeature,
  lengthExpression,
  metricThreads,
  type PlaneRef,
} from '@core/contracts';
import { Icon } from '../../shared/icon';
import { bodyNames } from './body-names';
import { DesignStore } from '../sketch/design-store';
import { featureLabels, holePoints, type PickTarget } from './feature-drafts';

const operations: readonly { value: BodyOperation; label: string }[] = [
  { value: 'new-body', label: 'New body' },
  { value: 'join', label: 'Join' },
  { value: 'cut', label: 'Cut' },
  { value: 'intersect', label: 'Intersect' },
];

const hints: Readonly<Record<Feature['type'], string>> = {
  insert: 'Brings an imported STEP, STL, OBJ or 3MF file in as bodies you can sketch on, cut and round.',
  extrude: 'Click profiles in the view to add or remove them.',
  revolve: 'Click profiles in the view; the axis can be a construction line of the sketch or an edge.',
  fillet: 'Click the edges to round.',
  chamfer: 'Click the edges to bevel.',
  shell: 'Click the faces to open; the walls keep the thickness.',
  plane: 'Offset from an origin plane, a construction plane or a flat face.',
  'linear-pattern': 'Repeats holes and bosses made by the selected features.',
  'circular-pattern': 'Repeats them around an axis; 360° spreads the copies evenly.',
  mirror: 'Mirrors them across a plane.',
  combine: 'Joins bodies into the target, cuts them from it, or keeps only where they overlap. Click bodies in the view to add them.',
  split: 'Cuts a body in two along a plane; the piece behind the plane becomes a new body.',
  move: 'Turns the bodies about an axis, then shifts them. Click bodies in the view to add or remove them.',
  scale: 'Scales the bodies about the origin, the same in every direction.',
  loft: 'Click one profile in each sketch, in order; the loft blends through their outlines.',
  sweep: 'Click the profiles to sweep; the path is the curves of another sketch, starting at the profile.',
  'path-pattern': 'Repeats the selected features along the curves of a sketch, evenly spaced.',
  hole: 'Holes go at the points of a sketch (drawn with the Point tool), into the material below it.',
  thread: 'Click the wall of a hole or a shaft. A thread is shown on the face; modelled threads are cut.',
  draft: 'Click the faces to taper. They lean away from the pull direction (the neutral plane\'s normal) by the angle.',
  rib: 'The open curves of a sketch, thickened and extruded along its normal: stiffeners for walls and floors.',
  'base-flange': 'Click the profiles of the flat sheet. The sheet rules here hold for the whole part: its edge flanges and its flat pattern.',
  'edge-flange': 'Click straight edges of the sheet; each gets a bend and a flange, bent towards the side of the face the edge is on.',
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
    if (draft.target === 'plane' || draft.target === 'second') return 'Click a flat face in the view.';
    if (draft.feature.type === 'plane' && draft.feature.mode === 'points') return 'Click three vertices (corners) in the view.';
    return hints[draft.feature.type];
  });

  /** Sketches that have profiles, for extrude and revolve. */
  protected readonly sketches = computed(() =>
    (this.store.state()?.document.timeline ?? []).filter(isSketch).filter((s) => (this.store.state()?.sketches.get(s.id)?.profiles.length ?? 0) > 0),
  );
  /** All sketches before the marker, as paths. */
  protected readonly pathSketches = computed(() => {
    const document = this.store.state()?.document;
    return (document?.timeline ?? []).slice(0, (document?.timeline.length ?? 0) - (document?.rollbackIndex ?? 0)).filter(isSketch);
  });

  /** A loft section as a label: its sketch's name and which of its profiles. */
  protected sectionLabel(section: { readonly sketch: string; readonly profile: string }): string {
    const state = this.store.state();
    const sketch = state?.document.timeline.find((i) => i.id === section.sketch);
    const index = state?.sketches.get(section.sketch)?.profiles.findIndex((p) => p.id === section.profile) ?? -1;
    return `${sketch?.name ?? 'Missing sketch'}, profile ${index + 1}`;
  }

  protected removeSection(index: number): void {
    const f = this.feature();
    if (f?.type === 'loft') this.set({ sections: f.sections.filter((_, i) => i !== index) });
  }

  protected readonly isToolFeature = isToolFeature;
  protected readonly threadSizes = Object.keys(metricThreads);

  /** Sketches with points of their own, for holes. */
  protected readonly holeSketches = computed(() => this.pathSketches().filter((s) => holePoints(this.store.state()?.sketches.get(s.id)?.sketch).length > 0));

  protected setHoleSketch(id: string): void {
    this.set({ sketch: id, points: holePoints(this.store.state()?.sketches.get(id)?.sketch) });
  }

  /** Construction lines of the chosen sketch, as revolve axes. */
  protected readonly axisLines = computed(() => {
    const f = this.feature();
    if (f?.type !== 'revolve') return [];
    const sketch = this.store.state()?.sketches.get(f.sketch)?.sketch;
    return (sketch?.entities ?? []).filter((e) => e.kind === 'line' && e.construction).map((e, i) => ({ id: e.id, label: `Construction line ${i + 1}` }));
  });
  /** Extrudes and revolves before this feature (a new one goes in at the rollback marker), for patterns and mirrors. */
  protected readonly tools = computed(() => {
    const f = this.feature();
    const document = this.store.state()?.document;
    const timeline = document?.timeline ?? [];
    const at = f ? timeline.findIndex((i) => i.id === f.id) : -1;
    const end = at >= 0 ? at : timeline.length - (document?.rollbackIndex ?? 0);
    return timeline.slice(0, end).filter(isRepeatable);
  });
  /** The bodies at this point of the timeline, with their names. */
  protected readonly bodyOptions = computed(() => {
    const state = this.store.state();
    const ids = (state?.bodies ?? []).map((b) => b.body);
    const names = bodyNames(ids, state?.document.timeline ?? []);
    return ids.map((id) => ({ id, name: names.get(id) ?? id }));
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
  protected setPlane(value: string, key: 'base' | 'plane' | 'second'): void {
    if (value === 'face') return this.set({}, key === 'second' ? 'second' : 'plane');
    const plane: PlaneRef = value.startsWith('plane:') ? { plane: value.slice(6) } : (value as 'XY' | 'XZ' | 'YZ');
    this.set({ [key]: plane } as Partial<Feature>);
  }

  protected toggleTool(id: string, on: boolean): void {
    const f = this.feature();
    if (f?.type !== 'linear-pattern' && f?.type !== 'circular-pattern' && f?.type !== 'mirror' && f?.type !== 'path-pattern') return;
    this.set({ features: on ? [...f.features, id] : f.features.filter((x) => x !== id) });
  }

  /** Adds or removes a body of a combine's tools, or of the bodies to move or scale. */
  protected toggleBody(id: string, on: boolean): void {
    const f = this.feature();
    if (f?.type === 'combine') this.set({ tools: on ? [...f.tools, id] : f.tools.filter((x) => x !== id) });
    if (f?.type === 'move' || f?.type === 'scale') this.set({ bodies: on ? [...f.bodies, id] : f.bodies.filter((x) => x !== id) });
  }

  protected setTranslate(i: number, expression: string): void {
    const f = this.feature();
    if (f?.type !== 'move') return;
    const translate = [...f.translate] as [string, string, string];
    translate[i] = expression;
    this.set({ translate });
  }

  /** Switches a construction plane's mode, keeping its base plane where the new mode has one. */
  protected setPlaneMode(mode: string): void {
    const f = this.feature();
    if (f?.type !== 'plane') return;
    const base = f.mode === 'points' ? 'XY' : f.base;
    const common = { id: f.id, name: f.name, suppressed: f.suppressed, type: 'plane' as const };
    const next: Feature =
      mode === 'angle'
        ? { ...common, mode, base, axis: { kind: 'origin', axis: 'X' }, angle: '45 deg' }
        : mode === 'midplane'
          ? { ...common, mode, base, second: 'XY' }
          : mode === 'points'
            ? { ...common, mode, points: [] }
            : { ...common, base, offset: '10' };
    this.store.updateDraft(next);
  }

  /** A length field's value: plain numbers are in the component's unit. */
  protected length(event: Event): string {
    return lengthExpression(this.value(event), this.store.units());
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
