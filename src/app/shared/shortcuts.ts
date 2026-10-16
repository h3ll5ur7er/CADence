import { DOCUMENT, Injectable, inject } from '@angular/core';
import { chordOf, commandFor, keysFor, precedence, type ShortcutCommand, shortcutCommands, type ShortcutScope } from './keymap';
import { UserSettings } from './user-settings';

export type ShortcutHandlers = Readonly<Partial<Record<ShortcutCommand, () => void>>>;

/** Something the command palette runs: a shortcut command, or an action registered with `registerActions`. */
export interface PaletteAction {
  readonly label: string;
  /** Where it belongs, shown beside it: "Create", "Documents", "Settings". */
  readonly group: string;
  readonly run: () => void;
  readonly keys?: readonly string[];
}

const scopeGroups: Readonly<Record<ShortcutScope, string>> = { sketch: 'Sketch', modeling: 'Model', document: 'Edit', view: 'View', app: 'CADence' };

/**
 * Turns key presses into commands of the active control scheme (docs/User-guide.md#keyboard-and-mouse).
 * Parts of the editor register handlers for their scope while they are shown; typing in a field
 * never triggers a shortcut.
 */
@Injectable({ providedIn: 'root' })
export class Shortcuts {
  private readonly settings = inject(UserSettings);
  private registrations: { readonly scope: ShortcutScope; readonly handlers: ShortcutHandlers }[] = [];
  private actions: (readonly PaletteAction[])[] = [];

  constructor() {
    inject(DOCUMENT).addEventListener('keydown', (event) => this.handle(event));
  }

  /** Handles the given commands while registered; returns the function that unregisters them. */
  register(scope: ShortcutScope, handlers: ShortcutHandlers): () => void {
    const registration = { scope, handlers };
    this.registrations = [...this.registrations, registration];
    return () => (this.registrations = this.registrations.filter((r) => r !== registration));
  }

  /** Offers actions in the command palette while registered; returns the function that withdraws them. */
  registerActions(actions: readonly PaletteAction[]): () => void {
    this.actions = [...this.actions, actions];
    return () => (this.actions = this.actions.filter((a) => a !== actions));
  }

  /** Everything that can run now: the commands handled in the scopes in effect (with their keys), then the registered actions. */
  available(): PaletteAction[] {
    const scopes = this.scopes();
    const scheme = this.settings.controls();
    const seen = new Set<ShortcutCommand>(['palette']);
    const commands: PaletteAction[] = [];
    for (const { scope, handlers } of this.inEffect(scopes)) {
      for (const [command, run] of Object.entries(handlers) as [ShortcutCommand, () => void][]) {
        if (seen.has(command)) continue;
        seen.add(command);
        commands.push({ label: shortcutCommands[command].label, group: scopeGroups[scope], run, keys: keysFor(scheme, command) });
      }
    }
    return [...commands, ...this.actions.flat()];
  }

  /** Registrations in the scopes in effect, most specific scope and latest first. */
  private inEffect(scopes: Set<ShortcutScope>) {
    return [...this.registrations]
      .reverse()
      .filter((r) => scopes.has(r.scope))
      .sort((a, b) => precedence.indexOf(a.scope) - precedence.indexOf(b.scope));
  }

  /** The scopes in effect: a sketch being edited replaces modeling. */
  private scopes(): Set<ShortcutScope> {
    const scopes = new Set(this.registrations.map((r) => r.scope));
    if (scopes.has('sketch')) scopes.delete('modeling');
    return scopes;
  }

  private handle(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable], dialog[open]')) return;
    const chord = chordOf(event);
    const command = chord && commandFor(this.settings.controls(), chord, this.scopes());
    if (!command) return;
    // The most specific scope handles it (a sketch's Escape before the editor's); within a scope, the latest registration.
    const handler = this.inEffect(this.scopes()).find((r) => r.handlers[command])?.handlers[command];
    if (!handler) return;
    event.preventDefault();
    handler();
  }
}
