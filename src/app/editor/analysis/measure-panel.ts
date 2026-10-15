import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Icon } from '../../shared/icon';
import { DesignStore } from '../sketch/design-store';
import { degrees, millimetres } from './units';

/** The measure tool: picks faces and edges in the 3D view and shows what lies between them. */
@Component({
  selector: 'cad-measure-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="eyebrow">Inspect</p>
    <div class="head">
      <h2>Measure</h2>
      <button type="button" class="icon-btn" aria-label="Close measure" (click)="store.openPanel(undefined)">×</button>
    </div>
    <p class="hint">Click faces and edges in the view. One pick gives its size; two give the distance and angle between them.</p>
    @if (picks().length) {
      <ul class="picks" aria-label="Measured elements">
        @for (pick of picks(); track pick.key) {
          <li>
            <span>{{ pick.label }}</span>
            <span class="mono name" [title]="pick.name">{{ pick.name }}</span>
          </li>
        }
      </ul>
      <button type="button" class="btn" (click)="store.measurePicks.set([])"><cad-icon name="trash" [size]="14" /> Clear</button>
    }
    @let result = store.measurement.value();
    @if (result && !result.ok) {
      <p class="error" role="alert">{{ result.error.message }}</p>
    } @else if (result?.ok && result.value; as m) {
      <dl class="results" aria-label="Measurement">
        @if (m.distance !== undefined) {
          <dt>Distance</dt>
          <dd class="mono" data-testid="measure-distance">{{ mm(m.distance) }}</dd>
        }
        @if (m.angle !== undefined) {
          <dt>Angle</dt>
          <dd class="mono" data-testid="measure-angle">{{ deg(m.angle) }}</dd>
        }
        @if (m.radius !== undefined) {
          <dt>Radius</dt>
          <dd class="mono" data-testid="measure-radius">{{ mm(m.radius) }} <span class="muted">(⌀ {{ mm(2 * m.radius) }})</span></dd>
        }
        @if (m.length !== undefined) {
          <dt>Length</dt>
          <dd class="mono" data-testid="measure-length">{{ mm(m.length) }}</dd>
        }
        @if (m.area !== undefined) {
          <dt>Area</dt>
          <dd class="mono" data-testid="measure-area">{{ mm(m.area, 2) }}</dd>
        }
      </dl>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); align-content: start; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    h2 { font-size: 15px; }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .picks { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; font-size: 13px; }
    .picks li { display: grid; gap: 2px; padding: var(--space-2); border-radius: var(--radius); background: color-mix(in srgb, var(--selection) 14%, transparent); }
    .name { overflow: hidden; color: var(--text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .btn { justify-self: start; }
    .results { display: grid; grid-template-columns: auto 1fr; gap: var(--space-2) var(--space-3); margin: 0; font-size: 13px; }
    dt { color: var(--text-muted); }
    dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
    .muted { color: var(--text-muted); }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; }
  `,
})
export class MeasurePanel {
  protected readonly store = inject(DesignStore);
  protected readonly mm = millimetres;
  protected readonly deg = degrees;

  protected readonly picks = computed(() => {
    const timeline = this.store.state()?.document.timeline ?? [];
    return this.store.measurePicks().map((pick) => ({
      key: `${pick.kind}:${pick.body}:${pick.name}`,
      label: `${pick.kind === 'face' ? 'Face' : 'Edge'} of ${timeline.find((i) => i.id === pick.body)?.name ?? pick.body}`,
      name: pick.name,
    }));
  });
}
