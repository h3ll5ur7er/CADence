import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { type JointFreedom, jointDofs, type MotionLink } from '@core/contracts';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';

const kindLabels: Readonly<Record<MotionLink['kind'], string>> = { gear: 'Gears', rack: 'Rack and pinion', belt: 'Belt or chain' };

/** A selected motion link: which joint drives which, and by how much (from teeth or diameters). */
@Component({
  selector: 'cad-link-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (link(); as link) {
      <p class="eyebrow">Motion link</p>
      <div class="head">
        <h2>{{ link.name }}</h2>
        <button type="button" class="icon-btn" [attr.aria-label]="'Delete ' + link.name" title="Delete" (click)="remove(link)">
          <cad-icon name="trash" [size]="14" />
        </button>
      </div>
      <label class="field">
        Kind
        <select id="link-kind" (change)="setKind(link, $any(value($event)))">
          @for (k of kinds; track k) {
            <option [value]="k" [selected]="k === link.kind">{{ kindLabels[k] }}</option>
          }
        </select>
      </label>
      @for (side of sides; track side.key) {
        <label class="field">
          {{ side.label }}
          <select [id]="'link-' + side.key" (change)="setFreedom(link, side.key, value($event))">
            @for (f of freedoms(); track f.key) {
              <option [value]="f.key" [selected]="f.key === key(link[side.key])">{{ f.label }}</option>
            }
          </select>
        </label>
      }
      <div class="grid">
        <label class="field">
          {{ link.kind === 'gear' ? 'Teeth of the driver' : link.kind === 'rack' ? 'Pinion pitch ⌀ (mm)' : 'Driver pulley ⌀ (mm)' }}
          <input id="link-size-a" type="number" min="0" step="any" [value]="sizes()[0]" (change)="setSize(link, 0, $event)" />
        </label>
        @if (link.kind !== 'rack') {
          <label class="field">
            {{ link.kind === 'gear' ? 'Teeth of the driven' : 'Driven pulley ⌀ (mm)' }}
            <input id="link-size-b" type="number" min="0" step="any" [value]="sizes()[1]" (change)="setSize(link, 1, $event)" />
          </label>
        }
      </div>
      <label class="field">
        Ratio ({{ link.kind === 'rack' ? 'mm per degree' : 'turns per turn' }})
        <input id="link-ratio" type="number" step="any" [value]="round(link.ratio)" (change)="save(link, { ratio: number($event) })" />
      </label>
      <label class="check"><input type="checkbox" [checked]="link.ratio < 0" (change)="save(link, { ratio: -link.ratio })" /> The other way round</label>
      @if (store.error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
    }
  `,
  styleUrl: './assembly-panels.scss',
})
export class LinkPanel {
  readonly linkId = input.required<string>();
  protected readonly store = inject(AssemblyStore);
  protected readonly kindLabels = kindLabels;
  protected readonly kinds = Object.keys(kindLabels) as MotionLink['kind'][];
  protected readonly sides = [
    { key: 'driver', label: 'Driver' },
    { key: 'driven', label: 'Driven' },
  ] as const;
  /** Teeth or diameters the ratio was worked out from (not stored: the ratio is what counts). */
  protected readonly sizes = signal<readonly [number, number]>([20, 20]);

  protected readonly link = computed(() => this.store.state()?.document.links?.find((l) => l.id === this.linkId()));
  protected readonly freedoms = computed(() =>
    (this.store.state()?.document.joints ?? []).flatMap((j) => jointDofs[j.type].map((dof, i) => ({ key: `${j.id}:${i}`, label: `${j.name} · ${dof.label}` }))),
  );

  protected key(f: JointFreedom): string {
    return `${f.joint}:${f.dof}`;
  }

  /** The value a freedom has now. */
  private valueOf(f: JointFreedom): number {
    return this.store.state()?.document.joints.find((j) => j.id === f.joint)?.values[f.dof] ?? 0;
  }

  /** Saves a change, keeping the driven joint where it is (the offset absorbs the difference). */
  protected save(link: MotionLink, change: Partial<MotionLink>): void {
    const next = { ...link, ...change };
    void this.store.run({ type: 'set-link', link: { ...next, offset: this.valueOf(next.driven) - next.ratio * this.valueOf(next.driver) } });
  }

  protected setKind(link: MotionLink, kind: MotionLink['kind']): void {
    this.save(link, { kind, ratio: this.ratioOf(kind, this.sizes()) });
  }

  protected setFreedom(link: MotionLink, side: 'driver' | 'driven', key: string): void {
    const [joint, dof] = key.split(':') as [string, string];
    this.save(link, { [side]: { joint, dof: Number(dof) } });
  }

  protected setSize(link: MotionLink, index: 0 | 1, event: Event): void {
    const sizes = this.sizes().map((v, i) => (i === index ? this.number(event) : v)) as unknown as readonly [number, number];
    this.sizes.set(sizes);
    // Turned the other way round than the kind turns by itself: kept so.
    const reversed = link.ratio < 0 !== (link.kind === 'gear');
    this.save(link, { ratio: this.ratioOf(link.kind, sizes) * (reversed ? -1 : 1) });
  }

  /** Gears turn the other way by teeth over teeth; a rack moves π·d/360 mm per degree; a belt turns the same way by diameters. */
  private ratioOf(kind: MotionLink['kind'], [a, b]: readonly [number, number]): number {
    if (kind === 'rack') return (Math.PI * a) / 360;
    const ratio = a / (b || 1);
    return kind === 'gear' ? -ratio : ratio;
  }

  protected remove(link: MotionLink): void {
    this.store.selection.set(undefined);
    void this.store.run({ type: 'remove-link', linkId: link.id });
  }

  protected round(value: number): number {
    return Math.round(value * 10000) / 10000;
  }

  protected number(event: Event): number {
    return Number((event.target as HTMLInputElement).value);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
