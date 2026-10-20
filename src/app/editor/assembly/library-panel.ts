import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AssemblyStore } from './assembly-store';

/**
 * Inserts parts from libraries (CAD-151, CAD-152): the built-in standard parts in every size, and the
 * components of projects marked as libraries; into a hole picked in the view, with a joint.
 */
@Component({
  selector: 'cad-library-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.libraryDraft(); as draft) {
      <p class="eyebrow">Insert</p>
      <div class="head">
        <h2>From a library</h2>
        <button type="button" class="icon-btn" aria-label="Close the library" (click)="store.closeLibrary()">×</button>
      </div>
      <label class="field">
        <span>Library</span>
        <select id="library" (change)="store.chooseLibrary(value($event))">
          @for (library of store.libraries(); track library.id) {
            <option [value]="library.id" [selected]="library.id === draft.library">{{ library.name }} ({{ library.partCount }})</option>
          }
        </select>
      </label>
      <label class="field">
        <span>Find</span>
        <input #search id="library-search" autocomplete="off" placeholder="M3 × 12, nut, 608…" (input)="query.set(search.value)" />
      </label>
      <ul class="parts" aria-label="Library parts">
        @for (group of groups(); track group.name) {
          @if (group.name) {
            <li class="group">{{ group.name }}</li>
          }
          @for (part of group.parts; track part.id) {
            <li>
              <button type="button" class="part" [class.active]="part.id === draft.part" [attr.aria-pressed]="part.id === draft.part" (click)="store.updateLibrary({ part: part.id })">{{ part.name }}</button>
            </li>
          }
        } @empty {
          <li class="hint">No parts match.</li>
        }
      </ul>
      <button type="button" class="side" [class.active]="true" data-testid="library-hole">
        <span class="label">Into</span>
        <span>{{ hole() }}</span>
      </button>
      <label class="check">
        <input id="library-flip" type="checkbox" [checked]="draft.flip" (change)="store.updateLibrary({ flip: !draft.flip })" />
        Turn the part over
      </label>
      @if (store.error(); as error) {
        <p class="error" role="alert">{{ error }}</p>
      }
      <div class="actions">
        <button type="button" class="btn" (click)="store.closeLibrary()">Done</button>
        <button type="button" class="btn btn-primary" [disabled]="!draft.part" (click)="store.insertFromLibrary()">Insert</button>
      </div>
    }
  `,
  styleUrl: './assembly-panels.scss',
  styles: `
    .parts { display: grid; max-height: 240px; overflow: auto; margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--radius); }
    .group { padding: var(--space-1) var(--space-2); background: var(--surface-2, var(--surface-1)); color: var(--text-muted); font-size: 11px; font-weight: 600; }
    .part { width: 100%; padding: 3px var(--space-2); border: 0; background: none; color: var(--text); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
    .part:hover { background: var(--accent-soft); }
    .part.active { background: var(--accent); color: var(--on-accent, white); }
  `,
})
export class LibraryPanel {
  protected readonly store = inject(AssemblyStore);
  protected readonly query = signal('');

  /** The parts that match, by group; at most a few hundred, so the list stays quick. */
  protected readonly groups = computed(() => {
    const words = this.query().toLowerCase().replace(/[x×]/g, ' ').split(/\s+/).filter(Boolean);
    const groups = new Map<string, { id: string; name: string }[]>();
    for (const part of this.store.libraryParts()) {
      const name = part.name.toLowerCase().replace(/×/g, ' ');
      if (!words.every((w) => name.includes(w) || (part.group ?? '').toLowerCase().includes(w))) continue;
      groups.set(part.group ?? '', [...(groups.get(part.group ?? '') ?? []), part]);
    }
    return [...groups].map(([name, parts]) => ({ name, parts }));
  });

  protected readonly hole = computed(() => {
    const hole = this.store.libraryDraft()?.hole;
    if (!hole) return 'Click a hole’s edge or round face in the view, or insert it free';
    const instance = this.store.state()?.document.instances.find((i) => i.id === hole.instance);
    return `${hole.ref?.kind === 'edge' ? 'edge' : 'face'} of ${instance?.name ?? 'an instance'}`;
  });

  protected value(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
