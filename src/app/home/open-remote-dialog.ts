import { ChangeDetectionStrategy, Component, type ElementRef, inject, output, signal, viewChild } from '@angular/core';
import type { ProjectSummary } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { credentialsOf, RemoteFields, RemoteSignIns } from '../shared/remote-fields';

/** Opens a project shared in a git repository (on another device, or by someone else). */
@Component({
  selector: 'cad-open-remote-dialog',
  imports: [RemoteFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog open-remote" aria-labelledby="open-remote-heading">
      <form (submit)="$event.preventDefault(); openProject()">
        <h2 id="open-remote-heading">Open from git</h2>
        <p class="hint">Opens a project synced to a git repository; it stays synced with it.</p>
        <cad-remote-fields [(url)]="url" [(corsProxy)]="corsProxy" [(username)]="username" [(password)]="password" />
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions">
          <button type="button" class="btn" (click)="dialog.close()">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !url().trim()">{{ busy() ? 'Opening…' : 'Open project' }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .open-remote { width: min(520px, calc(100vw - 32px)); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
  `,
})
export class OpenRemoteDialog {
  readonly opened = output<ProjectSummary>();
  protected readonly url = signal('');
  protected readonly corsProxy = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly signIns = inject(RemoteSignIns);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.error.set(undefined);
    this.dialog().nativeElement.showModal();
  }

  protected async openProject(): Promise<void> {
    this.busy.set(true);
    try {
      const url = this.url().trim();
      const corsProxy = this.corsProxy().trim();
      const credentials = credentialsOf(this.username(), this.password());
      const result = await this.projects.openRemoteProject({ url, ...(corsProxy ? { corsProxy } : {}) }, credentials);
      if (!result.ok) return this.error.set(result.error.message);
      this.signIns.remember(url, credentials);
      this.dialog().nativeElement.close();
      this.opened.emit(result.value);
    } finally {
      this.busy.set(false);
    }
  }
}
