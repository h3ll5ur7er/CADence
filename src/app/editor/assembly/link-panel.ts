import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { type JointFreedom, jointDofs, linkedValue, type MotionLink, planetaryRatios } from '@core/contracts';
import { Icon } from '../../shared/icon';
import { AssemblyStore } from './assembly-store';

const kindLabels: Readonly<Record<MotionLink['kind'], string>> = {
  gear: 'Gears',
  bevel: 'Bevel gears',
  worm: 'Worm and wheel',
  rack: 'Rack and pinion',
  belt: 'Belt or chain',
  carrier: 'Sun to planet carrier',
  planet: 'Sun to planet',
  cam: 'Cam and follower',
};

/** What the sizes the ratio comes from are, per kind (a rack has one, a cam none: its profile). */
const sizeLabels: Readonly<Record<MotionLink['kind'], readonly string[]>> = {
  gear: ['Teeth of the driver', 'Teeth of the driven'],
  bevel: ['Teeth of the driver', 'Teeth of the driven'],
  worm: ['Starts of the worm', 'Teeth of the wheel'],
  rack: ['Pinion pitch ⌀ (mm)'],
  belt: ['Driver pulley ⌀ (mm)', 'Driven pulley ⌀ (mm)'],
  carrier: ['Teeth of the sun', 'Teeth of the ring (fixed)'],
  planet: ['Teeth of the sun', 'Teeth of the ring (fixed)'],
  cam: [],
};

/** A cam to start from: one lobe, 5 mm high. */
const firstProfile: readonly (readonly [number, number])[] = [
  [0, 0],
  [90, 5],
  [180, 0],
  [270, 0],
];

/** Kinds that turn the driven joint the other way by themselves. */
const reverses = (kind: MotionLink['kind']) => kind === 'gear' || kind === 'bevel' || kind === 'worm' || kind === 'planet';

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
        @for (label of sizeLabels[link.kind]; track $index) {
          <label class="field">
            {{ label }}
            <input [id]="$index === 0 ? 'link-size-a' : 'link-size-b'" type="number" min="0" step="any" [value]="sizes()[$index]" (change)="setSize(link, $index === 0 ? 0 : 1, $event)" />
          </label>
        }
      </div>
      @if (link.kind === 'cam') {
        <label class="field">
          Profile: the cam's angle (°) and the follower's lift, one pair a line
          <textarea id="link-profile" rows="6" [value]="profileText(link)" (change)="setProfile(link, $event)"></textarea>
        </label>
      }
      <label class="field">
        {{ link.kind === 'cam' ? 'Scale of the lift' : link.kind === 'rack' ? 'Ratio (mm per degree)' : 'Ratio (turns per turn)' }}
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
  protected readonly sizeLabels = sizeLabels;
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
    void this.store.run({ type: 'set-link', link: { ...next, offset: this.valueOf(next.driven) - linkedValue({ ...next, offset: 0 }, this.valueOf(next.driver)) } });
  }

  protected setKind(link: MotionLink, kind: MotionLink['kind']): void {
    const { profile: _, ...rest } = link;
    this.save(kind === 'cam' ? { ...rest, profile: link.profile ?? firstProfile } : rest, { kind, ratio: this.ratioOf(kind, this.sizes()) });
  }

  protected profileText(link: MotionLink): string {
    return (link.profile ?? []).map(([angle, lift]) => `${angle} ${lift}`).join('\n');
  }

  /** A profile typed as pairs of numbers, one pair a line (spaces, commas or semicolons between). */
  protected setProfile(link: MotionLink, event: Event): void {
    const pairs = this.value(event)
      .split(/\n/)
      .map((line) => line.trim().split(/[\s,;]+/).map(Number))
      .filter((pair) => pair.length === 2 && pair.every(Number.isFinite)) as [number, number][];
    this.save(link, { profile: pairs });
  }

  protected setFreedom(link: MotionLink, side: 'driver' | 'driven', key: string): void {
    const [joint, dof] = key.split(':') as [string, string];
    this.save(link, { [side]: { joint, dof: Number(dof) } });
  }

  protected setSize(link: MotionLink, index: 0 | 1, event: Event): void {
    const sizes = this.sizes().map((v, i) => (i === index ? this.number(event) : v)) as unknown as readonly [number, number];
    this.sizes.set(sizes);
    // Turned the other way round than the kind turns by itself: kept so.
    const reversed = link.ratio < 0 !== reverses(link.kind);
    this.save(link, { ratio: this.ratioOf(link.kind, sizes) * (reversed ? -1 : 1) });
  }

  /**
   * Gears (and bevel gears) turn the other way by teeth over teeth, a worm's wheel by starts over teeth
   * (each about its axis towards the other part, as the parts are built: CAD-160); a rack moves π·d/360 mm per degree; a belt turns the
   * same way by diameters; a planetary set's carrier and planets follow from the sun's and ring's teeth.
   */
  private ratioOf(kind: MotionLink['kind'], [a, b]: readonly [number, number]): number {
    if (kind === 'rack') return (Math.PI * a) / 360;
    if (kind === 'carrier' || kind === 'planet') return planetaryRatios(a, b)[kind];
    if (kind === 'cam') return 1;
    const ratio = a / (b || 1);
    return reverses(kind) ? -ratio : ratio;
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
