import { DOCUMENT, Injectable, inject } from '@angular/core';
import { chordOf, commandFor, precedence, type ShortcutCommand, type ShortcutScope } from './keymap';
import { UserSettings } from './user-settings';

export type ShortcutHandlers = Readonly<Partial<Record<ShortcutCommand, () => void>>>;

/**
 * Turns key presses into commands of the active control scheme (docs/User-guide.md#keyboard-and-mouse).
 * Parts of the editor register handlers for their scope while they are shown; typing in a field
 * never triggers a shortcut.
 */
@Injectable({ providedIn: 'root' })
export class Shortcuts {
  private readonly settings = inject(UserSettings);
  private registrations: { readonly scope: ShortcutScope; readonly handlers: ShortcutHandlers }[] = [];

  constructor() {
    inject(DOCUMENT).addEventListener('keydown', (event) => this.handle(event));
  }

  /** Handles the given commands while registered; returns the function that unregisters them. */
  register(scope: ShortcutScope, handlers: ShortcutHandlers): () => void {
    const registration = { scope, handlers };
    this.registrations = [...this.registrations, registration];
    return () => (this.registrations = this.registrations.filter((r) => r !== registration));
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
    const scopes = this.scopes();
    const handler = [...this.registrations]
      .reverse()
      .filter((r) => r.handlers[command] && scopes.has(r.scope))
      .sort((a, b) => precedence.indexOf(a.scope) - precedence.indexOf(b.scope))[0]?.handlers[command];
    if (!handler) return;
    event.preventDefault();
    handler();
  }
}
