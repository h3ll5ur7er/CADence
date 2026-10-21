import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { Configuration, Parameter } from '@core/contracts';
import type { ConfigurationImport } from '@core/managers/design';
import { newId } from '@core/utilities/identity';
import { Icon } from '../../shared/icon';
import { DesignStore } from '../sketch/design-store';
import { HelpLink } from '../../shared/help';

/** The component's parameters: names usable in every dimension and feature value. */
@Component({
  selector: 'cad-parameters-panel',
  imports: [HelpLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="eyebrow">Component</p>
    <div class="head">
      <h2>Parameters</h2>
      <cad-help topic="parameters" />
      <button type="button" class="icon-btn" aria-label="Close parameters" (click)="store.openPanel(undefined)">×</button>
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
    <h3 class="eyebrow">Project parameters</h3>
    <p class="hint">Shared by every component of the project. A component parameter of the same name wins.</p>
    <table aria-label="Project parameters">
      <thead>
        <tr><th>Name</th><th>Expression</th><th>Value</th><th><span class="visually-hidden">Delete</span></th></tr>
      </thead>
      <tbody>
        @for (row of projectRows(); track row.parameter.id) {
          <tr>
            <td><input [attr.aria-label]="'Name of project parameter ' + row.parameter.name" [value]="row.parameter.name" (change)="saveShared(row.parameter, { name: value($event) })" /></td>
            <td><input [attr.aria-label]="'Expression of project parameter ' + row.parameter.name" [value]="row.parameter.expression" (change)="saveShared(row.parameter, { expression: value($event) })" /></td>
            <td class="mono value">{{ row.display ?? (row.overridden ? 'overridden here' : '—') }}</td>
            <td>
              <button type="button" class="icon-btn" [attr.aria-label]="'Delete project parameter ' + row.parameter.name" (click)="removeShared(row.parameter)">
                <cad-icon name="trash" [size]="14" />
              </button>
            </td>
          </tr>
        }
        <tr class="new">
          <td><input aria-label="New project parameter name" placeholder="name" [value]="sharedName()" (input)="sharedName.set(value($event))" /></td>
          <td><input aria-label="New project parameter expression" placeholder="e.g. 3 mm" [value]="sharedExpression()" (input)="sharedExpression.set(value($event))" (keydown.enter)="addShared()" /></td>
          <td colspan="2"><button type="button" class="btn" aria-label="Add project parameter" (click)="addShared()"><cad-icon name="plus" /> Add</button></td>
        </tr>
      </tbody>
    </table>
    <h3 class="eyebrow">Configurations</h3>
    <p class="hint">Variants of the component: other values for some parameters. Empty cells keep the parameter's own value.</p>
    <label class="shown">
      Shown
      <select aria-label="Shown configuration" (change)="activate(value($event))">
        <option value="" [selected]="!active()">The parameters' own values</option>
        @for (c of configurations(); track c.id) {
          <option [value]="c.id" [selected]="c.id === active()">{{ c.name }}</option>
        }
      </select>
    </label>
    @if (configurations().length) {
      <div class="scroll">
        <table aria-label="Configurations">
          <thead>
            <tr>
              <th>Configuration</th>
              @for (name of parameterNames(); track name) {
                <th>{{ name }}</th>
              }
              <th><span class="visually-hidden">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            @for (c of configurations(); track c.id) {
              <tr>
                <td><input [attr.aria-label]="'Name of configuration ' + c.name" [value]="c.name" (change)="renameConfiguration(c, value($event))" /></td>
                @for (name of parameterNames(); track name) {
                  <td><input [attr.aria-label]="name + ' in ' + c.name" [value]="c.values[name] ?? ''" [placeholder]="defaults().get(name) ?? ''" (change)="setValue(c, name, value($event))" /></td>
                }
                <td>
                  <button type="button" class="icon-btn" [attr.aria-label]="'Delete configuration ' + c.name" (click)="removeConfiguration(c)">
                    <cad-icon name="trash" [size]="14" />
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
    <div class="csv">
      <button type="button" class="btn" (click)="store.exportConfigurations()"><cad-icon name="download" /> Export CSV</button>
      <label class="btn">
        <cad-icon name="upload" /> Import CSV…
        <input type="file" accept=".csv,text/csv" class="visually-hidden" aria-label="Import configurations from CSV" (change)="importCsv($event)" />
      </label>
    </div>
    @if (pending(); as p) {
      <div class="pending" role="region" aria-label="Configurations to import">
        <p data-testid="csv-summary">{{ summary(p) }}</p>
        @for (problem of p.problems; track problem) {
          <p class="error">{{ problem }}</p>
        }
        <div class="actions">
          <button type="button" class="btn" (click)="pending.set(undefined)">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="p.problems.length > 0" (click)="applyCsv(p)">Apply</button>
        </div>
      </div>
    }
    <div class="add-configuration">
      <input aria-label="New configuration name" placeholder="name" [value]="configurationName()" (input)="configurationName.set(value($event))" (keydown.enter)="addConfiguration()" />
      <button type="button" class="btn" aria-label="Add configuration" (click)="addConfiguration()"><cad-icon name="plus" /> Add</button>
    </div>
    @if (store.error(); as error) {
      <p class="error" role="alert">{{ error }}</p>
    }
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); }
    .head { display: flex; justify-content: space-between; align-items: center; }
    h2 { font-size: 15px; }
    h3 { margin: var(--space-2) 0 0; }
    .shown { display: grid; gap: var(--space-1); font-size: 12px; color: var(--text-muted); }
    .shown select { height: 28px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); font: 13px var(--font); }
    .scroll { overflow-x: auto; }
    .scroll input { min-width: 64px; }
    .csv { display: flex; gap: var(--space-1); }
    .pending { display: grid; gap: var(--space-1); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); font-size: 12px; }
    .pending p { margin: 0; }
    .pending .actions { display: flex; justify-content: flex-end; gap: var(--space-1); }
    .add-configuration { display: grid; grid-template-columns: 1fr auto; gap: var(--space-1); }
    .add-configuration input { height: 28px; }
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
  protected readonly rows = computed(() => (this.store.state()?.parameters ?? []).filter((p) => !p.project));
  /** The project's parameters with their values here (none where the component has its own of that name). */
  protected readonly projectRows = computed(() => {
    const shown = new Map((this.store.state()?.parameters ?? []).filter((p) => p.project).map((p) => [p.parameter.id, p.display]));
    return this.store.projectParameters().map((parameter) => ({ parameter, display: shown.get(parameter.id), overridden: !shown.has(parameter.id) }));
  });
  protected readonly sharedName = signal('');
  protected readonly configurationName = signal('');
  protected readonly configurations = computed(() => this.store.state()?.document.configurations ?? []);
  protected readonly active = computed(() => this.store.state()?.document.configuration ?? '');
  /** Every parameter a configuration can set: the component's and the project's. */
  protected readonly parameterNames = computed(() => [...new Set((this.store.state()?.parameters ?? []).map((p) => p.parameter.name))]);
  /** Each parameter's own expression, shown in empty cells. */
  protected readonly defaults = computed(() => new Map((this.store.state()?.parameters ?? []).map((p) => [p.parameter.name, p.parameter.expression])));
  protected readonly sharedExpression = signal('');
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

  protected async addShared(): Promise<void> {
    const parameter = { id: newId(), name: this.sharedName().trim(), expression: this.sharedExpression().trim() };
    if (!parameter.name || !parameter.expression) return;
    if (await this.store.setProjectParameters([...this.store.projectParameters(), parameter])) {
      this.sharedName.set('');
      this.sharedExpression.set('');
    }
  }

  protected saveShared(parameter: Parameter, changes: Partial<Parameter>): void {
    void this.store.setProjectParameters(this.store.projectParameters().map((p) => (p.id === parameter.id ? { ...p, ...changes } : p)));
  }

  protected removeShared(parameter: Parameter): void {
    void this.store.setProjectParameters(this.store.projectParameters().filter((p) => p.id !== parameter.id));
  }

  protected activate(id: string): void {
    void this.store.run({ type: 'activate-configuration', ...(id ? { configuration: id } : {}) });
  }

  protected async addConfiguration(): Promise<void> {
    const name = this.configurationName().trim();
    if (!name) return;
    const configuration = { id: newId(), name, values: {} };
    if (await this.store.run({ type: 'set-configurations', configurations: [...this.configurations(), configuration] })) this.configurationName.set('');
  }

  protected renameConfiguration(configuration: Configuration, name: string): void {
    this.saveConfiguration({ ...configuration, name: name.trim() });
  }

  /** Sets one parameter's value in a configuration; an empty value takes the parameter's own again. */
  protected setValue(configuration: Configuration, name: string, expression: string): void {
    const values = Object.fromEntries(Object.entries(configuration.values).filter(([key]) => key !== name));
    if (expression.trim()) values[name] = expression.trim();
    this.saveConfiguration({ ...configuration, values });
  }

  protected removeConfiguration(configuration: Configuration): void {
    void this.store.run({ type: 'set-configurations', configurations: this.configurations().filter((c) => c.id !== configuration.id) });
  }

  private saveConfiguration(configuration: Configuration): void {
    void this.store.run({ type: 'set-configurations', configurations: this.configurations().map((c) => (c.id === configuration.id ? configuration : c)) });
  }

  /** A configuration table read from a file, waiting to be applied. */
  protected readonly pending = signal<ConfigurationImport | undefined>(undefined);

  protected async importCsv(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.pending.set(this.store.readConfigurations(await file.text()));
  }

  protected summary(read: ConfigurationImport): string {
    const parts = [
      read.added.length ? `new: ${read.added.join(', ')}` : '',
      read.changed.length ? `changed: ${read.changed.join(', ')}` : '',
      read.removed.length ? `removed: ${read.removed.join(', ')}` : '',
    ].filter(Boolean);
    const count = `${read.configurations.length} configuration${read.configurations.length === 1 ? '' : 's'}`;
    return `${count}${parts.length ? ` (${parts.join('; ')})` : ', as they are now'}.`;
  }

  protected async applyCsv(read: ConfigurationImport): Promise<void> {
    if (await this.store.run({ type: 'set-configurations', configurations: read.configurations })) this.pending.set(undefined);
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
