import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { TopologyRef } from '@core/contracts';
import { lengthIn, pointIn } from '../analysis/units';
import { DesignStore } from '../sketch/design-store';
import { bodyNames } from './body-names';

/** Repairs a feature that lost faces, edges or vertices: the replacements are picked in the view or chosen nearby. */
@Component({
  selector: 'cad-repair-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="eyebrow">Repair</p>
    <div class="head">
      <h2>{{ item()?.name }}</h2>
      <button type="button" class="icon-btn" aria-label="Close repair" (click)="store.openPanel(undefined)">×</button>
    </div>
    <p class="hint">The model is rolled back to just before it. For each lost reference, click its replacement in the view (the likeliest ones are highlighted) or choose one below: those of the same kind and size first, then the nearest.</p>
    <ul class="lost" aria-label="Lost references">
      @for (b of store.broken(); track b.ref.name; let i = $index) {
        <li [class.current]="i === store.repairTarget()">
          <button type="button" class="target" [attr.aria-pressed]="i === store.repairTarget()" (click)="store.repairTarget.set(i)">
            Lost {{ b.ref.kind }} of {{ bodyName(b.ref.body) }}
            @if (b.ref.hint) {
              <span class="muted">at {{ at(b.ref.hint) }}</span>
            }
          </button>
          @for (c of b.candidates; track c.ref.name; let n = $index) {
            <button type="button" class="btn candidate" [class.same]="c.sameShape" (click)="store.replaceReference(b.ref, c.ref)">
              Use the {{ n === 0 ? '' : 'next ' }}{{ c.sameShape ? 'same-shaped' : n === 0 ? 'nearest' : '' }} {{ c.ref.kind }}{{ c.distance === undefined ? '' : ' (' + mm(c.distance) + ' away)' }}
            </button>
          }
        </li>
      } @empty {
        <li class="none" data-testid="nothing-lost">Nothing is lost: every face, edge and corner it uses is there.</li>
      }
    </ul>
    <button type="button" class="btn btn-primary" (click)="store.openPanel(undefined)">Done</button>
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); align-content: start; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    h2 { font-size: 15px; }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .lost { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; font-size: 13px; }
    .lost li { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); }
    .lost li.current { border-color: var(--accent); background: var(--accent-soft); }
    .target { display: grid; gap: 2px; padding: 0; border: 0; background: none; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .candidate { justify-self: start; }
    .candidate.same { border-color: var(--accent); }
    .muted, .none { color: var(--text-muted); font-size: 12px; }
    .btn-primary { justify-self: start; }
  `,
})
export class RepairPanel {
  protected readonly store = inject(DesignStore);
  protected readonly mm = (value: number) => lengthIn(this.store.units(), value);
  protected readonly at = (p: readonly number[]) => pointIn(this.store.units(), p);
  protected readonly item = computed(() => this.store.state()?.document.timeline.find((i) => i.id === this.store.repairing()?.itemId));
  private readonly names = computed(() => {
    const state = this.store.state();
    return bodyNames(state?.bodies.map((b) => b.body) ?? [], state?.document.timeline ?? []);
  });

  protected bodyName(body: TopologyRef['body']): string {
    return this.names().get(body) ?? body;
  }
}
