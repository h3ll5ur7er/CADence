import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, viewChild } from '@angular/core';
import { type ControlScheme, controlSchemes, keysFor, mouseBindings, type ShortcutCommand, shortcutCommands, type ShortcutScope } from './keymap';
import { Shortcuts } from './shortcuts';
import { UserSettings } from './user-settings';

const groups: readonly { readonly title: string; readonly scopes: readonly ShortcutScope[] }[] = [
  { title: 'General', scopes: ['app', 'document'] },
  { title: 'View', scopes: ['view'] },
  { title: 'Part modeling', scopes: ['modeling'] },
  { title: 'Sketch', scopes: ['sketch'] },
];

/** Settings of how CADence is worked: control scheme and camera, with the reference of every shortcut. Opens with "?". */
@Component({
  selector: 'cad-settings-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="dialog settings" aria-labelledby="settings-heading">
      <header>
        <h2 id="settings-heading">Settings</h2>
        <button type="button" class="icon-btn" aria-label="Close settings" (click)="close()">×</button>
      </header>
      <div class="choices">
        <label class="field">
          Controls
          <select id="settings-controls" autofocus [value]="settings.controls()" (change)="settings.controls.set($any($event.target).value)">
            @for (scheme of schemes; track scheme.id) {
              <option [value]="scheme.id">{{ scheme.label }}</option>
            }
          </select>
        </label>
        <label class="field">
          Camera
          <select id="settings-projection" [value]="settings.projection()" (change)="settings.projection.set($any($event.target).value)">
            <option value="perspective">Perspective</option>
            <option value="orthographic">Orthographic</option>
          </select>
        </label>
      </div>
      <section aria-labelledby="mouse-heading">
        <h3 id="mouse-heading">Mouse</h3>
        <dl class="keys" aria-label="Mouse">
          @for (row of mouse(); track row[0]) {
            <dt>{{ row[0] }}</dt>
            <dd>{{ row[1] }}</dd>
          }
        </dl>
      </section>
      @for (group of shortcuts(); track group.title) {
        <section [attr.aria-label]="group.title + ' shortcuts'">
          <h3>{{ group.title }}</h3>
          <dl class="keys">
            @for (row of group.rows; track row.command) {
              <dt>{{ row.label }}</dt>
              <dd>
                @for (chord of row.keys; track chord; let last = $last) {
                  <kbd>{{ chord }}</kbd>
                  @if (!last) {
                    <span class="or">or</span>
                  }
                }
              </dd>
            }
          </dl>
        </section>
      }
    </dialog>
  `,
  styleUrl: './dialogs.scss',
  styles: `
    .settings {
      width: min(560px, calc(100vw - 32px));
      max-height: calc(100vh - 64px);
      overflow: auto;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-4);
    }
    header h2 {
      margin: 0;
    }
    .choices {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    select {
      height: 34px;
      padding: 0 var(--space-2);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius);
      background: var(--surface-raised);
      color: var(--text);
      font: 14px var(--font);
    }
    h3 {
      margin: var(--space-4) 0 var(--space-2);
      font-size: 13px;
    }
    .keys {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--space-1) var(--space-4);
      margin: 0;
      font-size: 13px;
    }
    dt {
      color: var(--text-muted);
    }
    dd {
      margin: 0;
      text-align: right;
    }
    kbd {
      display: inline-block;
      min-width: 20px;
      padding: 1px 6px;
      border: 1px solid var(--border-strong);
      border-bottom-width: 2px;
      border-radius: 4px;
      background: var(--surface-raised);
      font: 12px var(--font-mono, monospace);
      text-align: center;
    }
    .or {
      margin: 0 var(--space-1);
      color: var(--text-muted);
      font-size: 11px;
    }
  `,
})
export class SettingsDialog {
  protected readonly settings = inject(UserSettings);
  protected readonly schemes = controlSchemes;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly mouse = computed(() => mouseBindings[this.settings.controls()].description);
  protected readonly shortcuts = computed(() => shortcutGroups(this.settings.controls()));

  constructor() {
    const stop = inject(Shortcuts).register('app', { help: () => this.open() });
    inject(DestroyRef).onDestroy(stop);
  }

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }
}

/** Every bound command of a scheme, grouped for the reference. */
export function shortcutGroups(scheme: ControlScheme) {
  const commands = Object.keys(shortcutCommands) as ShortcutCommand[];
  return groups
    .map((group) => ({
      title: group.title,
      rows: commands
        .filter((command) => group.scopes.includes(shortcutCommands[command].scope))
        .map((command) => ({ command, label: shortcutCommands[command].label, keys: keysFor(scheme, command) }))
        .filter((row) => row.keys.length > 0),
    }))
    .filter((group) => group.rows.length > 0);
}
