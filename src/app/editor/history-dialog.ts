import { ChangeDetectionStrategy, Component, type ElementRef, inject, output, signal, viewChild } from '@angular/core';
import type { DocumentSummary, Version } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { relativeTime } from '../shared/format';
import { HelpLink } from '../shared/help';

/**
 * A document's version history: when it changed and what changed, the names of versions, and
 * restoring it as it was.
 */
@Component({
  selector: 'cad-history-dialog',
  imports: [HelpLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog history" aria-labelledby="history-heading" (close)="document.set(undefined)">
      @if (document(); as doc) {
        <h2 id="history-heading">History of {{ doc.name }} <cad-help topic="versions" /></h2>
        <p class="hint">Versions are recorded a few seconds after changes. Name one to find it again; restoring keeps the history.</p>
        <ol class="versions" aria-label="Versions">
          @for (version of versions(); track version.id; let latest = $first) {
            <li>
              <div class="what">
                <span class="message">{{ version.message }}</span>
                <span class="when">{{ relativeTime(version.time) }}</span>
                @for (name of version.names; track name) {
                  <span class="name" data-testid="version-name">{{ name }}</span>
                }
                @if (version.shared === false) {
                  <span class="local" title="The project's repository does not have this version yet; the next sync sends it.">not synced yet</span>
                }
              </div>
              @if (naming() === version.id) {
                <form class="naming" (submit)="$event.preventDefault(); saveName(version, nameInput.value)">
                  <input #nameInput aria-label="Version name" placeholder="e.g. v1.0" autocomplete="off" />
                  <button type="submit" class="btn">Name</button>
                </form>
              } @else {
                <span class="actions">
                  <button type="button" class="btn btn-ghost" [attr.aria-label]="'Name the version from ' + relativeTime(version.time)" (click)="naming.set(version.id)">Name…</button>
                  @if (!latest) {
                    <button type="button" class="btn" [attr.aria-label]="'Restore the version from ' + relativeTime(version.time)" (click)="restore(version)">Restore</button>
                  }
                </span>
              }
            </li>
          } @empty {
            <li class="hint">No versions yet: one is recorded a few seconds after the next change.</li>
          }
        </ol>
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions end">
          <button type="button" class="btn btn-primary" (click)="dialog.close()">Close</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .history { width: min(560px, calc(100vw - 32px)); }
    .versions { display: grid; gap: var(--space-2); max-height: 50vh; overflow: auto; margin: var(--space-3) 0; padding: 0; list-style: none; }
    .versions li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); }
    .what { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); min-width: 0; }
    .message { font-weight: 500; }
    .when { color: var(--text-muted); font-size: 12px; }
    .name { padding: 1px 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); font-size: 11px; }
    .local { color: var(--text-muted); font-size: 11px; font-style: italic; }
    .actions { display: flex; gap: var(--space-1); flex: none; }
    .actions.end { justify-content: flex-end; }
    .naming { display: flex; gap: var(--space-1); }
    .naming input { width: 120px; height: 28px; padding: 0 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface-raised); color: var(--text); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; }
  `,
})
export class HistoryDialog {
  /** A document was restored: what shows it should load it again. */
  readonly restored = output<DocumentSummary>();
  protected readonly document = signal<DocumentSummary | undefined>(undefined);
  protected readonly versions = signal<readonly Version[]>([]);
  protected readonly naming = signal<string | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly relativeTime = (iso: string) => relativeTime(iso);
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  async open(document: DocumentSummary): Promise<void> {
    this.document.set(document);
    this.error.set(undefined);
    this.naming.set(undefined);
    // What is not recorded yet becomes the latest version first.
    await this.projects.recordVersion(document.projectId);
    await this.load();
    this.dialog().nativeElement.showModal();
  }

  protected async saveName(version: Version, name: string): Promise<void> {
    const document = this.document();
    if (!document || !name.trim()) return;
    const result = await this.projects.nameVersion(document.projectId, name, version.id);
    this.error.set(result.ok ? undefined : result.error.message);
    if (result.ok) {
      this.naming.set(undefined);
      await this.load();
    }
  }

  protected async restore(version: Version): Promise<void> {
    const document = this.document();
    if (!document) return;
    const result = await this.projects.restoreDocument(document.id, version.id);
    this.error.set(result.ok ? undefined : result.error.message);
    if (result.ok) {
      this.restored.emit(document);
      await this.load();
    }
  }

  private async load(): Promise<void> {
    const document = this.document();
    this.versions.set(document ? await this.projects.documentHistory(document.id) : []);
  }
}
