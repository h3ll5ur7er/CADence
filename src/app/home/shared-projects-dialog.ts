import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, output, resource, signal, viewChild } from '@angular/core';
import type { ProjectSummary, SharedProject } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { ServerAccounts } from '../shared/server-accounts';
import { ServerSignIn } from '../shared/server-sign-in';

const roleLabels = { owner: 'Owner', editor: 'Can edit', viewer: 'Can view' } as const;

/** The projects shared with you on a CADence server (CAD-177), to open here. */
@Component({
  selector: 'cad-shared-projects-dialog',
  imports: [ServerSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog shared" aria-labelledby="shared-heading">
      <h2 id="shared-heading">Shared projects</h2>
      <p class="hint">Projects on a CADence server that you own or that were shared with you. Opened here, they stay synced, and you edit them together with the others, live.</p>
      <cad-server-sign-in [(server)]="server" />
      @if (account()?.user) {
        <ul class="list" aria-label="Shared projects">
          @for (project of list.value() ?? []; track project.id) {
            <li>
              <span class="name">{{ project.name }}</span>
              <span class="role">{{ roleLabels[project.role] }}</span>
              <button type="button" class="btn" [attr.aria-label]="'Open ' + project.name" [disabled]="busy()" (click)="openProject(project)">Open</button>
            </li>
          } @empty {
            <li class="hint">Nothing shared yet: share a project from its editor (the people button in the top bar).</li>
          }
        </ul>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
      <div class="actions">
        <button type="button" class="btn" (click)="dialog.close()">Close</button>
      </div>
    </dialog>
  `,
  styles: `
    .shared { width: min(520px, calc(100vw - 32px)); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .list { display: grid; gap: var(--space-1); max-height: 40vh; overflow: auto; margin: 0; padding: 0; list-style: none; }
    .list li { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-1) var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); }
    .name { flex: 1; font-weight: 500; }
    .role { color: var(--text-muted); font-size: 12px; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
    .actions { display: flex; justify-content: flex-end; }
  `,
})
export class SharedProjectsDialog {
  readonly opened = output<ProjectSummary>();
  protected readonly server = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly roleLabels = roleLabels;
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly accounts = inject(ServerAccounts);
  protected readonly account = computed(() => (this.server() ? this.accounts.signInFor(this.server()) : undefined));
  protected readonly list = resource({
    params: () => (this.account()?.user ? this.account() : undefined),
    loader: async ({ params }) => {
      const found = await this.projects.sharedProjects(params);
      this.error.set(found.ok ? undefined : found.error.message);
      return found.ok ? found.value : [];
    },
  });
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(): void {
    this.error.set(undefined);
    this.server.set(this.accounts.latest()?.server ?? '');
    this.list.reload();
    this.dialog().nativeElement.showModal();
  }

  protected async openProject(project: SharedProject): Promise<void> {
    const account = this.account();
    if (!account) return;
    this.busy.set(true);
    try {
      const result = await this.projects.openShared(account, project.id);
      if (!result.ok) return this.error.set(result.error.message);
      this.dialog().nativeElement.close();
      this.opened.emit(result.value);
    } finally {
      this.busy.set(false);
    }
  }
}
