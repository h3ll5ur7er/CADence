import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { coneJoints, type Joint, jointDofs, type JointLimit, type JointOffset, type JointOrigin, type OffsetField } from '@core/contracts';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';
import { jointLabel } from './joint-types';
import { HelpLink } from '../../shared/help';

/** An offset field: along X, Y or the normal (0–2), the turn (3), the tilt (4) or the lean (5). */
type OffsetIndex = 0 | 1 | 2 | 3 | 4 | 5;

/** The offset field each input edits. */
const fieldOf: Readonly<Record<OffsetIndex, OffsetField>> = { 0: 'x', 1: 'y', 2: 'z', 3: 'angle', 4: 'tilt', 5: 'lean' };

/** A selected joint: drag its values, set limits, turn it over, delete it. */
@Component({
  selector: 'cad-joint-properties',
  imports: [HelpLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (joint(); as joint) {
      <p class="eyebrow">{{ label(joint) }} joint</p>
      <div class="head">
        <h2>{{ joint.name }}</h2>
        <cad-help topic="joints" />
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
      @for (hold of holds(); track $index) {
        <p class="hint held" role="status">{{ hold }}</p>
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
      @if (cones.has(joint.type)) {
        <label class="field">
          Cone (°)
          <input type="number" min="0" max="180" step="any" placeholder="none" aria-label="Cone limit" title="How far the moving side's axis may tip, any way" [value]="joint.cone ?? ''" (change)="cone(joint, $event)" />
        </label>
      }
      <label class="check">
        <input type="checkbox" [checked]="joint.flip" (change)="store.run({ type: 'edit-joint', joint: { ...joint, flip: !joint.flip } })" />
        Turn the moving side over
      </label>
      <label class="check" title="An actuator: moving other joints never changes its values, as a parallel mechanism's legs">
        <input type="checkbox" [checked]="!!joint.driven" (change)="driven(joint, $any($event.target).checked)" />
        Driven (an actuator)
      </label>
      @for (side of sides; track side.key) {
        <fieldset class="offset">
          <legend>Offset on {{ instanceName(joint[side.key].instance) }} ({{ side.label }})</legend>
          <div class="grid three">
            @for (axis of offsetAxes; track axis.label) {
              <label class="field">
                {{ axis.label }}
                <input
                  type="text"
                  inputmode="decimal"
                  [attr.aria-label]="axis.label + ' offset of ' + side.label"
                  [attr.title]="'A number, or an expression of the project parameters'"
                  [value]="offsetValue(joint[side.key], axis.index)"
                  (change)="setOffset(joint, side.key, axis.index, $event)"
                />
              </label>
            }
          </div>
        </fieldset>
      }
    }
  `,
  styleUrl: './assembly-panels.scss',
})
export class JointProperties {
  readonly jointId = input.required<string>();
  protected readonly store = inject(AssemblyStore);
  protected readonly label = (joint: Joint) => jointLabel(joint.type);

  protected readonly joint = computed(() => this.store.state()?.document.joints.find((j) => j.id === this.jointId()));
  protected readonly cones = coneJoints;

  /** Where a limit holds this joint (CAD-186). */
  protected readonly holds = computed(() => {
    const joint = this.joint();
    if (!joint) return [];
    return (this.store.state()?.holds ?? [])
      .filter((h) => h.joint === joint.id)
      .map((h) => {
        if (h.dof === 'cone') return `Held at its cone of ${this.round(h.value)}°${h.asked === undefined ? '' : ` (asked ${this.round(h.asked)}°)`}.`;
        const dof = jointDofs[joint.type][h.dof];
        const unit = dof?.kind === 'translate' ? ' mm' : '°';
        return `${dof?.label ?? 'A value'} is held at its ${h.at === 'min' ? 'minimum' : 'maximum'}, ${this.round(h.value)}${unit}${h.asked === undefined ? '' : ` (asked ${this.round(h.asked)}${unit})`}.`;
      });
  });

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

  /** An empty field removes the cone. */
  protected cone(joint: Joint, event: Event): void {
    const text = (event.target as HTMLInputElement).value.trim();
    const { cone: _old, ...rest } = joint;
    void this.store.run({ type: 'edit-joint', joint: text === '' ? rest : { ...rest, cone: Number(text) } });
  }

  protected driven(joint: Joint, on: boolean): void {
    const { driven: _old, ...rest } = joint;
    void this.store.run({ type: 'edit-joint', joint: on ? { ...rest, driven: true } : rest });
  }

  protected readonly sides = [
    { key: 'a', label: 'stays' },
    { key: 'b', label: 'moves' },
  ] as const;
  /** Along the picked frame's X, Y and normal (mm); the lean about the normal, the tilt about the new X and the turn about the new normal (°). */
  protected readonly offsetAxes = [
    { label: 'X', index: 0 },
    { label: 'Y', index: 1 },
    { label: 'Z', index: 2 },
    { label: 'Lean', index: 5 },
    { label: 'Tilt', index: 4 },
    { label: 'Turn', index: 3 },
  ] as const;

  /** The offset field's expression where it follows one (CAD-185), else its number. */
  protected offsetValue(origin: JointOrigin, index: OffsetIndex): string {
    const offset = origin.offset;
    const expression = offset?.expressions?.[fieldOf[index]];
    if (expression) return expression;
    return String(this.round(index === 3 ? offset?.angle : index === 4 ? offset?.tilt : index === 5 ? offset?.lean : offset?.translate[index]));
  }

  /** Moves one side's joint origin by a number or an expression of the project parameters; all zero removes the offset. */
  protected setOffset(joint: Joint, side: 'a' | 'b', index: OffsetIndex, event: Event): void {
    const text = (event.target as HTMLInputElement).value.trim();
    const number = text === '' ? 0 : Number(text);
    const field = fieldOf[index];
    const current = joint[side].offset ?? { translate: [0, 0, 0], angle: 0 };
    // A number replaces the field's expression; anything else becomes one, evaluated by the assembly.
    const { [field]: _old, ...others } = current.expressions ?? {};
    const expressions = Number.isFinite(number) ? others : { ...others, [field]: text };
    const value = Number.isFinite(number) ? number : 0;
    const moved: JointOffset =
      index === 3
        ? { ...current, angle: value }
        : index === 4
          ? { ...current, tilt: value }
          : index === 5
            ? { ...current, lean: value }
            : { ...current, translate: current.translate.map((v, i) => (i === index ? value : v)) as [number, number, number] };
    const { expressions: _was, ...plain } = moved;
    const offset: JointOffset = Object.keys(expressions).length ? { ...plain, expressions } : plain;
    const { offset: _gone, ...rest } = joint[side];
    const zero = offset.angle === 0 && !offset.tilt && !offset.lean && !offset.axis && !offset.expressions && offset.translate.every((v) => v === 0);
    void this.store.run({ type: 'edit-joint', joint: { ...joint, [side]: zero ? rest : { ...rest, offset } } });
  }

  protected remove(joint: Joint): void {
    this.store.selection.set(undefined);
    void this.store.run({ type: 'remove-joint', jointId: joint.id });
  }
}
