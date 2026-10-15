import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { type CheckStatus, manufacturingProfiles, type ManufacturingProfile } from '@core/contracts';
import { Icon, type IconName } from '../../shared/icon';
import { DesignStore } from '../sketch/design-store';

interface Field {
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly set: (value: number) => ManufacturingProfile;
}

const statusIcons: Readonly<Record<CheckStatus, IconName>> = { pass: 'check', warning: 'warning', fail: 'cross' };
const custom = 'custom';

/** Manufacturability: the machine profile and how the design does against its rules. */
@Component({
  selector: 'cad-check-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="eyebrow">Inspect</p>
    <div class="head">
      <h2>Manufacturability</h2>
      <button type="button" class="icon-btn" aria-label="Close checks" (click)="store.openPanel(undefined)">×</button>
    </div>
    <label class="field wide">
      <span>Machine</span>
      <select id="check-profile" (change)="choose(value($event))">
        @for (preset of presets; track preset.name; let i = $index) {
          <option [value]="i" [selected]="presetIndex() === '' + i">{{ preset.name }}</option>
        }
        @if (presetIndex() === custom) {
          <option [value]="custom" selected>{{ store.process().name }}</option>
        }
      </select>
    </label>
    <div class="fields">
      @for (field of fields(); track field.label) {
        <label class="field">
          <span>{{ field.label }}</span>
          <span class="input">
            <input type="number" min="0" step="any" [value]="field.value" [attr.aria-label]="field.label" (change)="edit(field, value($event))" />
            <span class="unit">{{ field.unit }}</span>
          </span>
        </label>
      }
    </div>

    @if (store.report.isLoading() && !store.report.value()) {
      <p class="hint">Checking…</p>
    } @else if (store.report.value(); as report) {
      <p class="summary" data-testid="check-summary">{{ summary() }}</p>
      <ul class="checks" aria-label="Checks">
        @for (check of report.checks; track check.id) {
          <li [attr.data-status]="check.status" [attr.data-check]="check.id" [class.focused]="focusedId() === check.id">
            <cad-icon [name]="statusIcons[check.status]" [size]="16" />
            <div>
              <strong>{{ check.title }}</strong>
              <p>{{ check.message }}</p>
              @if (check.faces?.length) {
                <button type="button" class="link" (click)="store.focusedCheck.set(check.id)">
                  {{ focusedId() === check.id ? 'Shown in the view' : 'Show ' + check.faces.length + (check.faces.length === 1 ? ' face' : ' faces') }}
                </button>
              }
            </div>
          </li>
        }
      </ul>
    }
    @if (store.error(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); align-content: start; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    h2 { font-size: 15px; }
    .hint, .summary { margin: 0; color: var(--text-muted); font-size: 12px; }
    .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
    .field { display: grid; gap: 2px; min-width: 0; font-size: 11px; color: var(--text-muted); }
    select, .input { height: 28px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); font: 13px var(--font); }
    select { width: 100%; min-width: 0; padding: 0 4px; }
    .input { display: flex; align-items: center; min-width: 0; padding-right: 6px; }
    .input input { width: 100%; min-width: 0; flex: 1; height: 100%; padding: 0 6px; border: 0; background: none; color: inherit; font: 13px var(--font-mono); }
    .unit { color: var(--text-muted); font-size: 11px; }
    .checks { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .checks li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: var(--space-2); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); font-size: 12px; }
    .checks li.focused { border-color: var(--flag); }
    .checks p { margin: 2px 0 0; color: var(--text-muted); }
    [data-status='pass'] cad-icon { color: var(--ok); }
    [data-status='warning'] cad-icon { color: var(--warning); }
    [data-status='fail'] cad-icon { color: var(--danger); }
    .link { margin-top: var(--space-1); padding: 0; border: 0; background: none; color: var(--flag); font: inherit; font-weight: 600; cursor: pointer; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; }
  `,
})
export class CheckPanel {
  protected readonly store = inject(DesignStore);
  protected readonly presets = manufacturingProfiles;
  protected readonly statusIcons = statusIcons;
  protected readonly custom = custom;

  protected readonly presetIndex = computed(() => {
    const index = this.presets.findIndex((p) => JSON.stringify(p) === JSON.stringify(this.store.process()));
    return index < 0 ? custom : String(index);
  });

  protected readonly focusedId = computed(() => {
    const checks = this.store.report.value()?.checks ?? [];
    return this.store.focusedCheck() ?? checks.find((c) => c.status !== 'pass' && c.faces?.length)?.id;
  });

  protected readonly summary = computed(() => {
    const checks = this.store.report.value()?.checks ?? [];
    const count = (status: CheckStatus) => checks.filter((c) => c.status === status).length;
    const warnings = count('warning');
    const parts = [`${count('pass')} passed`, `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, `${count('fail')} failed`];
    return `${parts.join(', ')} for ${this.store.process().name}.`;
  });

  protected readonly fields = computed((): Field[] => {
    const p = this.store.process();
    const renamed = { name: p.kind === 'print' ? 'Custom printer' : 'Custom laser' };
    if (p.kind === 'print') {
      return [
        { label: 'Bed X', unit: 'mm', value: p.bed[0], set: (v) => ({ ...p, ...renamed, bed: [v, p.bed[1], p.bed[2]] }) },
        { label: 'Bed Y', unit: 'mm', value: p.bed[1], set: (v) => ({ ...p, ...renamed, bed: [p.bed[0], v, p.bed[2]] }) },
        { label: 'Height', unit: 'mm', value: p.bed[2], set: (v) => ({ ...p, ...renamed, bed: [p.bed[0], p.bed[1], v] }) },
        { label: 'Nozzle', unit: 'mm', value: p.nozzle, set: (v) => ({ ...p, ...renamed, nozzle: v }) },
        { label: 'Layer height', unit: 'mm', value: p.layerHeight, set: (v) => ({ ...p, ...renamed, layerHeight: v }) },
        { label: 'Max overhang', unit: '°', value: p.maxOverhang, set: (v) => ({ ...p, ...renamed, maxOverhang: v }) },
      ];
    }
    return [
      { label: 'Bed X', unit: 'mm', value: p.bed[0], set: (v) => ({ ...p, ...renamed, bed: [v, p.bed[1]] }) },
      { label: 'Bed Y', unit: 'mm', value: p.bed[1], set: (v) => ({ ...p, ...renamed, bed: [p.bed[0], v] }) },
      { label: 'Kerf', unit: 'mm', value: p.kerf, set: (v) => ({ ...p, ...renamed, kerf: v }) },
      { label: 'Sheet', unit: 'mm', value: p.thickness, set: (v) => ({ ...p, ...renamed, thickness: v }) },
    ];
  });

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected choose(index: string): void {
    const preset = this.presets[Number(index)];
    if (preset) void this.store.run({ type: 'set-process', process: preset });
  }

  protected edit(field: Field, value: string): void {
    void this.store.run({ type: 'set-process', process: field.set(Number(value)) });
  }
}
