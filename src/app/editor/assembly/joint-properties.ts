import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { type Joint, jointDofs, type JointLimit } from '@core/contracts';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';
import { jointLabel } from './joint-types';

/** A selected joint: drag its values, set limits, turn it over, delete it. */
@Component({
  selector: 'cad-joint-properties',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (joint(); as joint) {
      <p class="eyebrow">{{ label(joint) }} joint</p>
      <div class="head">
        <h2>{{ joint.name }}</h2>
        <button type="button" class="icon-btn" [attr.aria-label]="'Delete ' + joint.name" title="Delete" (click)="remove(joint)">
          <cad-icon name="trash" [size]="14" />
        </button>
      </div>
      <dl>
        <dt>Stays</dt>
        <dd>{{ instanceName(joint.a.instance) }}</dd>
        <dt>Moves</dt>
        <dd>{{ instanceName(joint.b.instance) }}</dd>
      </dl>
      @if (store.state()?.jointErrors?.get(joint.id); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
      @for (dof of dofs(); track dof.label; let i = $index) {
        <div class="dof" [attr.data-dof]="dof.label">
          <span class="field">{{ dof.label }} ({{ dof.unit }})</span>
          <div class="row">
            <input
              type="range"
              [attr.aria-label]="dof.label + ' of ' + joint.name"
              [min]="dof.min"
              [max]="dof.max"
              step="any"
              [value]="joint.values[i]"
              (input)="store.preview(joint.id, with(joint.values, i, number($event)))"
              (change)="store.setJointValues(joint.id, with(joint.values, i, number($event)))"
            />
            <input
              type="number"
              step="any"
              [attr.aria-label]="dof.label + ' value of ' + joint.name"
              [value]="round(joint.values[i])"
              (change)="store.setJointValues(joint.id, with(joint.values, i, number($event)))"
            />
          </div>
          <div class="grid">
            <label class="field">Min<input type="number" step="any" placeholder="none" [value]="joint.limits[i]?.min ?? ''" (change)="limit(joint, i, 'min', $event)" /></label>
            <label class="field">Max<input type="number" step="any" placeholder="none" [value]="joint.limits[i]?.max ?? ''" (change)="limit(joint, i, 'max', $event)" /></label>
          </div>
        </div>
      }
      <label class="check">
        <input type="checkbox" [checked]="joint.flip" (change)="store.run({ type: 'edit-joint', joint: { ...joint, flip: !joint.flip } })" />
        Turn the moving side over
      </label>
    }
  `,
  styleUrl: './assembly-panels.scss',
})
export class JointProperties {
  readonly jointId = input.required<string>();
  protected readonly store = inject(AssemblyStore);
  protected readonly label = (joint: Joint) => jointLabel(joint.type);

  protected readonly joint = computed(() => this.store.state()?.document.joints.find((j) => j.id === this.jointId()));

  /** Slider ranges: the limits, or a turn either way and ±200 mm. */
  protected readonly dofs = computed(() => {
    const joint = this.joint();
    if (!joint) return [];
    return jointDofs[joint.type].map((dof, i) => {
      const limit = joint.limits[i];
      const span = dof.kind === 'rotate' ? 180 : 200;
      return { label: dof.label, unit: dof.kind === 'rotate' ? '°' : 'mm', min: limit?.min ?? -span, max: limit?.max ?? span };
    });
  });

  protected instanceName(id: string): string {
    return this.store.state()?.document.instances.find((i) => i.id === id)?.name ?? id;
  }

  protected number(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  protected round(value: number | undefined): number {
    return Math.round((value ?? 0) * 1000) / 1000;
  }

  protected with(values: readonly number[], index: number, value: number): number[] {
    return values.map((v, i) => (i === index ? value : v));
  }

  /** An empty field removes that side of the limit; a limit needs both sides. */
  protected limit(joint: Joint, index: number, side: keyof JointLimit, event: Event): void {
    const text = (event.target as HTMLInputElement).value.trim();
    const current = joint.limits[index];
    const dof = jointDofs[joint.type][index];
    const span = dof?.kind === 'rotate' ? 180 : 200;
    const next: JointLimit | null =
      text === '' ? null : { min: current?.min ?? -span, max: current?.max ?? span, [side]: Number(text) };
    const limits = jointDofs[joint.type].map((_, i) => (i === index ? next : (joint.limits[i] ?? null)));
    void this.store.run({ type: 'edit-joint', joint: { ...joint, limits } });
  }

  protected remove(joint: Joint): void {
    this.store.selection.set(undefined);
    void this.store.run({ type: 'remove-joint', jointId: joint.id });
  }
}
