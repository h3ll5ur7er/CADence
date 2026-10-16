import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { InstancePattern, Vec3 } from '@core/contracts';
import { AssemblyStore } from './assembly-store';

const kindLabels: Readonly<Record<InstancePattern['kind'], string>> = { linear: 'Linear pattern', circular: 'Circular pattern', mirror: 'Mirror' };
const axes: readonly { readonly label: string; readonly direction: Vec3 }[] = [
  { label: 'X', direction: [1, 0, 0] },
  { label: 'Y', direction: [0, 1, 0] },
  { label: 'Z', direction: [0, 0, 1] },
];

/** Makes or changes a pattern of instances: which ones, in a row, around an axis or mirrored. */
@Component({
  selector: 'cad-pattern-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.patternDraft(); as p) {
      <p class="eyebrow">{{ existing() ? 'Edit pattern' : 'New pattern' }}</p>
      <div class="head">
        <h2>{{ p.name || kindLabels[p.kind] }}</h2>
      </div>
      <label class="field">
        Kind
        <select id="pattern-kind" (change)="change({ kind: $any(value($event)) })">
          @for (k of kinds; track k) {
            <option [value]="k" [selected]="k === p.kind">{{ kindLabels[k] }}</option>
          }
        </select>
      </label>
      <fieldset>
        <legend>Instances</legend>
        @for (i of instances(); track i.id) {
          <label class="check"><input type="checkbox" [checked]="p.instances.includes(i.id)" (change)="toggle(i.id, $any($event.target).checked)" /> {{ i.name }}</label>
        }
      </fieldset>
      <label class="field">
        {{ p.kind === 'mirror' ? 'Across the plane normal to' : p.kind === 'circular' ? 'Around the axis' : 'Along' }}
        <select id="pattern-axis" (change)="change({ direction: axes[+value($event)]!.direction })">
          @for (a of axes; track a.label; let i = $index) {
            <option [value]="i" [selected]="same(a.direction, p.direction)">{{ a.label }}</option>
          }
        </select>
      </label>
      @if (p.kind !== 'linear') {
        <div class="grid three">
          @for (c of [0, 1, 2]; track c) {
            <label class="field">
              {{ p.kind === 'mirror' ? 'Plane' : 'Axis' }} through {{ ['X', 'Y', 'Z'][c] }}
              <input type="number" step="any" [attr.aria-label]="'Pattern origin ' + ['X', 'Y', 'Z'][c]" [value]="p.origin[c]" (change)="setOrigin(c, $event)" />
            </label>
          }
        </div>
      }
      @if (p.kind !== 'mirror') {
        <div class="grid">
          <label class="field">
            Count (with the originals)
            <input id="pattern-count" type="number" min="2" step="1" [value]="p.count" (change)="change({ count: +value($event) })" />
          </label>
          <label class="field">
            {{ p.kind === 'circular' ? 'Angle between (°)' : 'Spacing (mm)' }}
            <input id="pattern-spacing" type="number" step="any" [value]="p.spacing" (change)="change({ spacing: +value($event) })" />
          </label>
        </div>
      }
      @if (store.error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
      <div class="actions">
        <button type="button" class="btn" (click)="cancel()">Cancel</button>
        <button type="button" class="btn btn-primary" (click)="store.commitPattern()">OK</button>
      </div>
    }
  `,
  styleUrl: './assembly-panels.scss',
  styles: '.grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }',
})
export class PatternPanel {
  protected readonly store = inject(AssemblyStore);
  protected readonly kindLabels = kindLabels;
  protected readonly kinds = Object.keys(kindLabels) as InstancePattern['kind'][];
  protected readonly axes = axes;
  protected readonly instances = computed(() => this.store.state()?.document.instances ?? []);
  protected readonly existing = computed(() => this.store.state()?.document.patterns?.some((p) => p.id === this.store.patternDraft()?.id) ?? false);

  protected change(changes: Partial<InstancePattern>): void {
    const draft = this.store.patternDraft();
    if (draft) this.store.patternDraft.set({ ...draft, ...changes });
  }

  protected toggle(id: string, on: boolean): void {
    const draft = this.store.patternDraft();
    if (draft) this.change({ instances: on ? [...draft.instances, id] : draft.instances.filter((i) => i !== id) });
  }

  protected setOrigin(index: number, event: Event): void {
    const draft = this.store.patternDraft();
    if (draft) this.change({ origin: draft.origin.map((v, i) => (i === index ? Number(this.value(event)) : v)) as unknown as Vec3 });
  }

  protected same(a: Vec3, b: Vec3): boolean {
    return a.every((v, i) => Math.abs(v - (b[i] as number)) < 1e-9);
  }

  protected cancel(): void {
    this.store.patternDraft.set(undefined);
    this.store.panel.set(undefined);
    this.store.error.set(undefined);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
