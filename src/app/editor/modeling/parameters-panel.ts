import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Parameter } from '@core/contracts';
import { newId } from '@core/utilities/identity';
import { Icon } from '../../shared/icon';
import { DesignStore } from '../sketch/design-store';

/** The component's parameters: names usable in every dimension and feature value. */
@Component({
  selector: 'cad-parameters-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="eyebrow">Component</p>
    <div class="head">
      <h2>Parameters</h2>
      <button type="button" class="icon-btn" aria-label="Close parameters" (click)="store.parametersOpen.set(false)">×</button>
    </div>
    <p class="hint">Use the names in any dimension or feature value, e.g. <code>wall * 2</code>. Units: mm, cm, in, deg.</p>
    <table aria-label="Parameters">
      <thead>
        <tr><th>Name</th><th>Expression</th><th>Value</th><th><span class="visually-hidden">Delete</span></th></tr>
      </thead>
      <tbody>
        @for (row of rows(); track row.parameter.id) {
          <tr>
            <td><input [attr.aria-label]="'Name of ' + row.parameter.name" [value]="row.parameter.name" (change)="save(row.parameter, { name: value($event) })" /></td>
            <td><input [attr.aria-label]="'Expression of ' + row.parameter.name" [value]="row.parameter.expression" (change)="save(row.parameter, { expression: value($event) })" /></td>
            <td class="mono value">{{ row.display ?? '—' }}</td>
            <td>
              <button type="button" class="icon-btn" [attr.aria-label]="'Delete ' + row.parameter.name" (click)="remove(row.parameter)">
                <cad-icon name="trash" [size]="14" />
              </button>
            </td>
          </tr>
        }
        <tr class="new">
          <td><input aria-label="New parameter name" placeholder="name" [value]="name()" (input)="name.set(value($event))" /></td>
          <td><input aria-label="New parameter expression" placeholder="e.g. 3 mm" [value]="expression()" (input)="expression.set(value($event))" (keydown.enter)="add()" /></td>
          <td colspan="2"><button type="button" class="btn" (click)="add()"><cad-icon name="plus" /> Add</button></td>
        </tr>
      </tbody>
    </table>
    @if (store.error(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); }
    .head { display: flex; justify-content: space-between; align-items: center; }
    h2 { font-size: 15px; }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; font-weight: 600; color: var(--text-muted); font-size: 11px; padding: 0 2px 4px; }
    td { padding: 2px; vertical-align: middle; }
    input { width: 100%; height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); font: 13px var(--font-mono); }
    .value { white-space: nowrap; color: var(--text-muted); }
    .new .btn { height: 28px; width: 100%; justify-content: center; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; }
  `,
})
export class ParametersPanel {
  protected readonly store = inject(DesignStore);
  protected readonly rows = computed(() => this.store.state()?.parameters ?? []);
  protected readonly name = signal('');
  protected readonly expression = signal('');

  protected async add(): Promise<void> {
    const parameter = { id: newId(), name: this.name().trim(), expression: this.expression().trim() };
    if (!parameter.name || !parameter.expression) return;
    if (await this.store.setParameter(parameter, true)) {
      this.name.set('');
      this.expression.set('');
    }
  }

  protected save(parameter: Parameter, changes: Partial<Parameter>): void {
    void this.store.setParameter({ ...parameter, ...changes }, false);
  }

  protected remove(parameter: Parameter): void {
    void this.store.run({ type: 'delete-parameter', id: parameter.id });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
