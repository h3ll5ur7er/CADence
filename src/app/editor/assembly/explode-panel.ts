import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import type { ExplodedView, ExplodeStep, Vec3 } from '@core/contracts';
import type { InstructionPicture } from '@core/managers/assembly';
import { newId } from '@core/utilities/identity';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';
import { HelpLink } from '../../shared/help';

const directions: readonly { readonly label: string; readonly direction: Vec3 }[] = [
  { label: '+X', direction: [1, 0, 0] },
  { label: '−X', direction: [-1, 0, 0] },
  { label: '+Y', direction: [0, 1, 0] },
  { label: '−Y', direction: [0, -1, 0] },
  { label: '+Z', direction: [0, 0, 1] },
  { label: '−Z', direction: [0, 0, -1] },
];

/** A selected exploded view: its steps, how far it is shown, and build instructions from it. */
@Component({
  selector: 'cad-explode-panel',
  imports: [HelpLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as view) {
      <p class="eyebrow">Exploded view</p>
      <div class="head">
        <h2>{{ view.name }}</h2>
        <cad-help topic="explode" />
        <button type="button" class="icon-btn" [attr.aria-label]="'Delete ' + view.name" title="Delete" (click)="remove(view)">
          <cad-icon name="trash" [size]="14" />
        </button>
      </div>
      <ol class="steps" aria-label="Steps">
        @for (step of view.steps; track step.id; let i = $index) {
          <li>
            <div class="head">
              <strong>Step {{ i + 1 }}</strong>
              <button type="button" class="icon-btn" [attr.aria-label]="'Delete step ' + (i + 1)" (click)="removeStep(view, step)"><cad-icon name="trash" [size]="12" /></button>
            </div>
            <p class="hint">{{ names(step) }}</p>
            <div class="grid">
              <label class="field">
                Direction
                <select [attr.aria-label]="'Direction of step ' + (i + 1)" (change)="saveStep(view, step, { direction: directionAt(+value($event)) })">
                  @for (d of directions; track d.label; let k = $index) {
                    <option [value]="k" [selected]="same(d.direction, step.direction)">{{ d.label }}</option>
                  }
                </select>
              </label>
              <label class="field">
                Distance (mm)
                <input type="number" step="any" [attr.aria-label]="'Distance of step ' + (i + 1)" [value]="step.distance" (change)="saveStep(view, step, { distance: +value($event) })" />
              </label>
            </div>
            <label class="check">
              <input type="checkbox" [attr.aria-label]="'Step ' + (i + 1) + ' moves away from the axis'" [checked]="!!step.radial" (change)="saveStep(view, step, { radial: $any($event.target).checked })" />
              Away from the axis (the direction, through the origin)
            </label>
          </li>
        } @empty {
          <li class="hint">Each step moves instances apart. Choose them below and add a step.</li>
        }
      </ol>
      <fieldset>
        <legend>Next step moves</legend>
        @for (i of instances(); track i.id) {
          <label class="check"><input type="checkbox" [checked]="chosen().includes(i.id)" (change)="choose(i.id, $any($event.target).checked)" /> {{ i.name }}</label>
        }
      </fieldset>
      <button type="button" class="btn" [disabled]="!chosen().length" (click)="addStep(view)"><cad-icon name="plus" /> Add step</button>
      @if (view.steps.length) {
        <label class="field">
          Shown <span class="mono">{{ position().toFixed(1) }} / {{ view.steps.length }}</span>
          <input type="range" aria-label="Explode" min="0" [max]="view.steps.length" step="0.01" [value]="position()" (input)="position.set(+value($event))" />
        </label>
        <button type="button" class="btn" [disabled]="busy()" (click)="instructions(view)"><cad-icon name="download" /> {{ busy() ? 'Making the pages…' : 'Build instructions (PDF)' }}</button>
      }
    }
  `,
  styleUrl: './assembly-panels.scss',
  styles: '.steps { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; } .steps li { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); }',
})
export class ExplodePanel {
  readonly viewId = input.required<string>();
  /** Takes a picture of the view (JPEG), framing a box. */
  readonly picture = input<(box: { min: Vec3; max: Vec3 } | undefined) => Promise<InstructionPicture | undefined>>(() => Promise.resolve(undefined));
  protected readonly store = inject(AssemblyStore);
  protected readonly directions = directions;
  protected readonly chosen = signal<readonly string[]>([]);
  protected readonly position = signal(0);
  protected readonly busy = signal(false);

  protected readonly view = computed(() => this.store.state()?.document.explodedViews?.find((v) => v.id === this.viewId()));
  /** Instances, and the copies their patterns make (CAD-110). */
  protected readonly instances = computed(() => {
    const state = this.store.state();
    if (!state) return [];
    const copies = [...state.copies].flatMap(([id, copy]) => {
      const original = state.document.instances.find((i) => i.id === copy.instance);
      return original ? [{ id, name: `${original.name} (copy ${id.split('/').at(-1)})` }] : [];
    });
    return [...state.document.instances.map(({ id, name }) => ({ id, name })), ...copies];
  });

  constructor() {
    // Shows the view as far as the slider says, following edits of its steps.
    effect(() => {
      const [view, position] = [this.view(), this.position()];
      if (view) untracked(() => this.store.showExploded(view.id, Math.min(position, view.steps.length)));
    });
    inject(DestroyRef).onDestroy(() => {
      this.store.previewPoses.set(undefined);
      this.store.trails.set([]);
    });
  }

  protected names(step: ExplodeStep): string {
    return step.instances.map((id) => this.instances().find((i) => i.id === id)?.name ?? id).join(', ');
  }

  protected choose(id: string, on: boolean): void {
    this.chosen.update((list) => (on ? [...list, id] : list.filter((i) => i !== id)));
  }

  protected async addStep(view: ExplodedView): Promise<void> {
    const step: ExplodeStep = { id: newId(), instances: this.chosen(), direction: [0, 0, 1], distance: 50 };
    if (await this.store.run({ type: 'set-exploded-view', view: { ...view, steps: [...view.steps, step] } })) {
      this.chosen.set([]);
      this.position.set(view.steps.length + 1);
    }
  }

  protected saveStep(view: ExplodedView, step: ExplodeStep, change: Partial<ExplodeStep>): void {
    void this.store.run({ type: 'set-exploded-view', view: { ...view, steps: view.steps.map((s) => (s.id === step.id ? { ...s, ...change } : s)) } });
  }

  protected removeStep(view: ExplodedView, step: ExplodeStep): void {
    void this.store.run({ type: 'set-exploded-view', view: { ...view, steps: view.steps.filter((s) => s.id !== step.id) } });
  }

  protected async instructions(view: ExplodedView): Promise<void> {
    this.busy.set(true);
    try {
      await this.store.exportInstructions(view.id, this.picture());
      this.position.set(view.steps.length);
    } finally {
      this.busy.set(false);
    }
  }

  protected remove(view: ExplodedView): void {
    this.store.select(undefined);
    void this.store.run({ type: 'remove-exploded-view', viewId: view.id });
  }

  protected directionAt(index: number): Vec3 {
    return (directions[index] ?? directions[4])?.direction ?? [0, 0, 1];
  }

  protected same(a: Vec3, b: Vec3): boolean {
    return a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
