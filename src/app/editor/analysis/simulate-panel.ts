import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { type Material, materials, type SimulationLoad, type TopologyRef, type Vec3 } from '@core/contracts';
import { Icon } from '../../shared/icon';
import { bodyNames } from '../modeling/body-names';
import { DesignStore } from '../sketch/design-store';
import { lengthIn } from './units';
import { HelpLink } from '../../shared/help';

/** Directions a force can push in, besides into its face. */
const axes: readonly { readonly label: string; readonly direction: Vec3 }[] = [
  { label: 'Down (−Z)', direction: [0, 0, -1] },
  { label: 'Up (+Z)', direction: [0, 0, 1] },
  { label: '−X', direction: [-1, 0, 0] },
  { label: '+X', direction: [1, 0, 0] },
  { label: '−Y', direction: [0, -1, 0] },
  { label: '+Y', direction: [0, 1, 0] },
];
const into = 'into';
const same = (a: Vec3, b: Vec3) => a.every((v, k) => Math.abs(v - (b[k] as number)) < 1e-6);
const mpa = (value: number) => `${Number(value.toPrecision(3)).toLocaleString('en-US')} MPa`;

/** A linear static strength check (CAD-93): fixed faces, loads, and the stresses and deflection they cause. */
@Component({
  selector: 'cad-simulate-panel',
  imports: [HelpLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="eyebrow">Inspect</p>
    <div class="head">
      <h2>Strength</h2>
      <cad-help topic="strength" />
      <button type="button" class="icon-btn" aria-label="Close strength check" (click)="store.openPanel(undefined)">×</button>
    </div>
    <p class="hint">Click faces in the view to hold them fixed or to load them, then run the check.</p>
    <div class="segmented" role="group" aria-label="Clicked faces">
      <button type="button" [attr.aria-pressed]="store.simulationPick() === 'fixed'" (click)="store.simulationPick.set('fixed')">Hold fixed</button>
      <button type="button" [attr.aria-pressed]="store.simulationPick() === 'load'" (click)="store.simulationPick.set('load')">Load</button>
    </div>

    <section aria-label="Fixed faces">
      <h3>Fixed</h3>
      @for (face of setup().fixed; track face.body + face.name) {
        <div class="row">
          <span class="label">{{ faceLabel(face) }}</span>
          <button type="button" class="icon-btn" [attr.aria-label]="'Release ' + faceLabel(face)" (click)="release(face)">×</button>
        </div>
      } @empty {
        <p class="hint">No face is held yet.</p>
      }
    </section>

    <section aria-label="Loads">
      <h3>Loads</h3>
      @for (load of setup().loads; track load.face.body + load.face.name; let i = $index) {
        <div class="load" [attr.data-load]="i">
          <div class="row">
            <span class="label">{{ faceLabel(load.face) }}</span>
            <button type="button" class="icon-btn" [attr.aria-label]="'Remove the load on ' + faceLabel(load.face)" (click)="removeLoad(i)">×</button>
          </div>
          <div class="fields">
            <select aria-label="Kind of load" (change)="setKind(i, value($event))">
              <option value="force" [selected]="load.kind === 'force'">Force</option>
              <option value="pressure" [selected]="load.kind === 'pressure'">Pressure</option>
            </select>
            <span class="input">
              <input type="number" step="any" [value]="load.kind === 'force' ? load.force : load.pressure" [attr.aria-label]="load.kind === 'force' ? 'Force' : 'Pressure'" (change)="setSize(i, +value($event))" />
              <span class="unit">{{ load.kind === 'force' ? 'N' : 'MPa' }}</span>
            </span>
            @if (load.kind === 'force') {
              <select class="wide" aria-label="Direction" (change)="setDirection(i, value($event))">
                <option [value]="into" [selected]="directionOf(load) === into">Into the face</option>
                @for (axis of axes; track axis.label; let k = $index) {
                  <option [value]="k" [selected]="directionOf(load) === '' + k">{{ axis.label }}</option>
                }
              </select>
            }
          </div>
        </div>
      } @empty {
        <p class="hint">No load yet: choose Load and click a face.</p>
      }
    </section>

    <label class="field">
      <span>Element size</span>
      <span class="input">
        <input type="number" min="0" step="any" placeholder="auto" aria-label="Element size" [value]="setup().size ?? ''" (change)="setElementSize(value($event))" />
        <span class="unit">mm</span>
      </span>
    </label>
    <p class="hint">{{ materialNote() }}</p>
    <button type="button" class="btn btn-primary" [disabled]="!ready() || store.simulating()" (click)="store.simulate()">
      <cad-icon name="play" [size]="14" /> {{ store.simulating() ? 'Calculating…' : 'Run' }}
    </button>

    @let result = store.simulationResult();
    @if (result && !result.ok) {
      <p class="error" role="alert">{{ result.error.message }}</p>
    } @else if (result?.ok && result.value; as r) {
      <dl class="results" aria-label="Strength results">
        <dt>Largest stress</dt>
        <dd class="mono" data-testid="sim-stress">{{ mpa(r.maxStress) }}</dd>
        <dt>Largest deflection</dt>
        <dd class="mono" data-testid="sim-deflection">{{ mm(r.maxDisplacement) }}</dd>
        @if (r.safetyFactor !== undefined) {
          <dt>Safety factor</dt>
          <dd class="mono" data-testid="sim-safety" [attr.data-status]="r.safetyFactor < 1 ? 'fail' : r.safetyFactor < 2 ? 'warning' : 'pass'">{{ r.safetyFactor.toFixed(1) }}</dd>
        }
        <dt>Elements</dt>
        <dd class="mono">{{ r.elements.toLocaleString('en-US') }}</dd>
      </dl>
      <div class="legend" aria-hidden="true">
        <span class="bar"></span>
        <span class="mono">0</span>
        <span class="mono">{{ mpa(r.maxStress) }}</span>
      </div>
      <label class="check"><input type="checkbox" [checked]="store.showDeformed()" (change)="store.showDeformed.set(!store.showDeformed())" /> Show the bent shape (exaggerated)</label>
      <p class="hint">Linear and static, for the solid material: printed parts are weaker across their layers, and sharp inside corners read higher than they are. Treat a safety factor below 2 with care.</p>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); align-content: start; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    h2 { font-size: 15px; }
    h3 { margin: 0 0 var(--space-1); color: var(--text-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    section { display: grid; gap: var(--space-1); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .segmented { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
    .segmented button { height: 28px; border: 0; background: var(--surface-raised); color: var(--text); font: 12px var(--font); cursor: pointer; }
    .segmented button[aria-pressed='true'] { background: var(--accent); color: var(--accent-contrast, #fff); }
    .row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-width: 0; font-size: 12px; }
    .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .load { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1); }
    .wide { grid-column: 1 / -1; }
    .field { display: grid; gap: 2px; min-width: 0; font-size: 11px; color: var(--text-muted); }
    select, .input { height: 28px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); font: 13px var(--font); }
    select { width: 100%; min-width: 0; padding: 0 4px; }
    .input { display: flex; align-items: center; min-width: 0; padding-right: 6px; }
    .input input { width: 100%; min-width: 0; flex: 1; height: 100%; padding: 0 6px; border: 0; background: none; color: inherit; font: 13px var(--font-mono); }
    .unit { color: var(--text-muted); font-size: 11px; }
    .btn { justify-self: start; }
    .results { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-3); margin: 0; font-size: 13px; }
    dt { color: var(--text-muted); }
    dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    [data-status='pass'] { color: var(--ok); }
    [data-status='warning'] { color: var(--warning); }
    [data-status='fail'] { color: var(--danger); }
    .legend { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--space-2); font-size: 11px; color: var(--text-muted); }
    .bar { grid-column: 1 / -1; height: 8px; border-radius: 4px; background: linear-gradient(to right, #0000ff, #00ff00, #ff0000); }
    .legend span:last-child { text-align: right; }
    .check { display: flex; gap: var(--space-2); align-items: center; font-size: 12px; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; }
  `,
})
export class SimulatePanel {
  protected readonly store = inject(DesignStore);
  protected readonly axes = axes;
  protected readonly into = into;
  protected readonly mpa = mpa;
  protected readonly mm = (value: number) => lengthIn(this.store.units(), value);
  protected readonly setup = this.store.simulationSetup;
  protected readonly ready = computed(() => this.setup().fixed.length > 0 && this.setup().loads.length > 0);

  private readonly names = computed(() => {
    const state = this.store.state();
    return bodyNames(state?.bodies.map((b) => b.body) ?? [], state?.document.timeline ?? []);
  });

  protected readonly materialNote = computed(() => {
    const own: Material = this.store.state()?.document.material ?? (materials[0] as Material);
    const m = { ...materials.find((c) => c.name === own.name), ...own };
    if (!m.youngsModulus) return `${m.name} has no stiffness to calculate with: choose a material from the list in the browser.`;
    return `${m.name}: stiffness ${(m.youngsModulus / 1000).toLocaleString('en-US')} GPa${m.yieldStrength ? `, yields at ${m.yieldStrength} MPa` : ''}.`;
  });

  protected faceLabel(face: TopologyRef): string {
    return `Face of ${this.names().get(face.body) ?? face.body}`;
  }

  protected directionOf(load: SimulationLoad): string {
    if (load.kind !== 'force') return into;
    if (same(load.direction, this.store.inward(load.face))) return into;
    const index = axes.findIndex((a) => same(a.direction, load.direction));
    return index < 0 ? into : String(index);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected release(face: TopologyRef): void {
    void this.store.setSimulation({ ...this.setup(), fixed: this.setup().fixed.filter((f) => f.body !== face.body || f.name !== face.name) });
  }

  protected removeLoad(index: number): void {
    void this.store.setSimulation({ ...this.setup(), loads: this.setup().loads.filter((_, i) => i !== index) });
  }

  protected setKind(index: number, kind: string): void {
    this.replaceLoad(index, (load) =>
      kind === 'pressure' ? { kind: 'pressure', face: load.face, pressure: 0.1 } : { kind: 'force', face: load.face, force: 100, direction: this.store.inward(load.face) },
    );
  }

  protected setSize(index: number, size: number): void {
    this.replaceLoad(index, (load) => (load.kind === 'force' ? { ...load, force: size } : { ...load, pressure: size }));
  }

  protected setDirection(index: number, choice: string): void {
    this.replaceLoad(index, (load) =>
      load.kind === 'force' ? { ...load, direction: choice === into ? this.store.inward(load.face) : ((axes[Number(choice)] as (typeof axes)[number]).direction) } : load,
    );
  }

  protected setElementSize(text: string): void {
    const { size: _old, ...rest } = this.setup();
    const size = Number(text);
    void this.store.setSimulation(text.trim() && size > 0 ? { ...rest, size } : rest);
  }

  private replaceLoad(index: number, change: (load: SimulationLoad) => SimulationLoad): void {
    void this.store.setSimulation({ ...this.setup(), loads: this.setup().loads.map((l, i) => (i === index ? change(l) : l)) });
  }
}
