import { ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { type PaletteAction, Shortcuts } from './shortcuts';

/**
 * How well `query` matches `text`: its letters in order, scored higher for matches at word starts
 * and in runs; `undefined` when they are not all there.
 */
export function fuzzyScore(query: string, text: string): number | undefined {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  let score = 0;
  let at = -1;
  for (const c of q) {
    const found = t.indexOf(c, at + 1);
    if (found < 0) return undefined;
    const wordStart = found === 0 || /[\s:/(-]/.test(t[found - 1] as string);
    score += (found === at + 1 ? 3 : 0) + (wordStart ? 5 : 0) + 1;
    at = found;
  }
  // Shorter texts first among equals.
  return score - t.length / 100;
}

/** Finds and runs any command by name (Ctrl+K): tools, commands, documents and settings. */
@Component({
  selector: 'cad-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="palette" aria-label="Command palette" (close)="query.set('')">
      <input
        #input
        role="combobox"
        aria-label="Command"
        aria-expanded="true"
        aria-controls="palette-list"
        [attr.aria-activedescendant]="results().length ? 'palette-' + active() : null"
        autocomplete="off"
        placeholder="Type a command, tool or document"
        [value]="query()"
        (input)="search(input.value)"
        (keydown)="key($event)"
      />
      <ul id="palette-list" role="listbox" aria-label="Commands">
        @for (action of results(); track $index; let i = $index) {
          <li
            [id]="'palette-' + i"
            role="option"
            [attr.aria-selected]="i === active()"
            [class.active]="i === active()"
            tabindex="-1"
            (mousemove)="active.set(i)"
            (click)="run(action)"
            (keydown.enter)="run(action)"
          >
            <span class="label">{{ action.label }}</span>
            <span class="group">{{ action.group }}</span>
            @for (k of action.keys ?? []; track k; let first = $first) {
              @if (first) {
                <kbd>{{ k }}</kbd>
              }
            }
          </li>
        } @empty {
          <li class="none">Nothing matches.</li>
        }
      </ul>
    </dialog>
  `,
  styles: `
    .palette {
      width: min(560px, calc(100vw - 32px));
      max-height: min(480px, calc(100vh - 96px));
      margin: 12vh auto auto;
      padding: 0;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg, 8px);
      background: var(--surface-raised);
      color: var(--text);
      box-shadow: var(--shadow-lg, 0 12px 32px rgb(0 0 0 / 0.25));
    }
    .palette[open] { display: grid; grid-template-rows: auto 1fr; }
    .palette::backdrop { background: rgb(0 0 0 / 0.2); }
    input {
      height: 44px;
      padding: 0 var(--space-3);
      border: 0;
      border-bottom: 1px solid var(--border);
      background: none;
      color: var(--text);
      font: 15px var(--font);
      outline: none;
    }
    ul { overflow-y: auto; margin: 0; padding: var(--space-1); list-style: none; }
    li { display: flex; align-items: center; gap: var(--space-2); min-height: 32px; padding: 0 var(--space-2); border-radius: var(--radius); font-size: 13px; cursor: pointer; }
    li.active { background: var(--accent-soft); }
    .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group { color: var(--text-muted); font-size: 12px; }
    kbd { padding: 1px 6px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; font: 11px var(--font-mono, monospace); }
    .none { color: var(--text-muted); cursor: default; }
  `,
})
export class CommandPalette {
  private readonly shortcuts = inject(Shortcuts);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  protected readonly query = signal('');
  protected readonly active = signal(0);
  /** What can run, taken when the palette opens. */
  private readonly actions = signal<readonly PaletteAction[]>([]);

  protected readonly results = computed(() => {
    const query = this.query().trim();
    const actions = this.actions();
    if (!query) return actions.slice(0, 50);
    return actions
      .map((action) => ({ action, score: Math.max(fuzzyScore(query, action.label) ?? -Infinity, (fuzzyScore(query, `${action.group} ${action.label}`) ?? -Infinity) - 2) }))
      .filter((r) => r.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((r) => r.action);
  });

  constructor() {
    const stop = this.shortcuts.register('app', { palette: () => this.open() });
    inject(DestroyRef).onDestroy(stop);
  }

  open(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) return;
    this.actions.set(this.shortcuts.available());
    this.query.set('');
    this.active.set(0);
    dialog.showModal();
    this.input().nativeElement.focus();
  }

  protected search(query: string): void {
    this.query.set(query);
    this.active.set(0);
  }

  protected key(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count) this.active.set((this.active() + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
      document.getElementById(`palette-${this.active()}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const action = this.results()[this.active()];
      if (action) this.run(action);
    }
  }

  protected run(action: PaletteAction): void {
    // Closed first, so what it opens (a dialog, a panel) gets the focus.
    this.dialog().nativeElement.close();
    action.run();
  }
}
