import { ChangeDetectionStrategy, Component, type ElementRef, computed, inject, output, signal, viewChild } from '@angular/core';
import type { ConflictChoice, ItemConflict, ProjectSummary, SyncConflict, SyncOutcome } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { credentialsOf, RemoteFields, RemoteSignIns } from '../shared/remote-fields';
import { ServerAccounts } from '../shared/server-accounts';

const outcomes: Readonly<Record<Exclude<SyncOutcome['kind'], 'conflicts'>, string>> = {
  'up-to-date': 'Up to date: this project and the repository hold the same versions.',
  pushed: 'Sent the versions of this project to the repository.',
  pulled: 'Took the versions from the repository.',
  merged: 'Combined the changes made here and in the repository, and sent the result.',
};

/** Shares a project's versions with a git repository: where, the sign-in, and choices for conflicts. */
@Component({
  selector: 'cad-sync-dialog',
  imports: [RemoteFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog sync" aria-labelledby="sync-heading">
      <form (submit)="$event.preventDefault(); sync()">
        <h2 id="sync-heading">Sync with git</h2>
        <p class="hint">Exchanges this project's versions with a git repository, so other devices and people can work on it too.</p>
        <cad-remote-fields [(url)]="url" [(corsProxy)]="corsProxy" [(username)]="username" [(password)]="password" />
        @if (conflicts().length) {
          <fieldset class="conflicts">
            <legend>Changed here and in the repository: keep which?</legend>
            @for (conflict of conflicts(); track conflict.path) {
              @if (conflict.items?.length) {
                <div class="items" data-testid="item-conflicts">
                  <span class="name">{{ conflict.name }}</span>
                  <p class="hint">Everything else of it was combined. These were changed on both sides:</p>
                  @for (item of conflict.items; track item.path) {
                    <div class="item" role="radiogroup" [attr.aria-label]="conflict.name + ': ' + item.label">
                      <span class="item-name">{{ item.label }}</span>
                      <label class="side">
                        <input type="radio" [name]="itemKey(conflict, item)" [checked]="choices()[itemKey(conflict, item)] === 'mine'" (change)="chooseItem(conflict, item, 'mine')" />
                        <span class="which">Mine</span>
                        <span class="value">{{ item.mine }}</span>
                      </label>
                      <label class="side">
                        <input type="radio" [name]="itemKey(conflict, item)" [checked]="choices()[itemKey(conflict, item)] === 'theirs'" (change)="chooseItem(conflict, item, 'theirs')" />
                        <span class="which">Theirs</span>
                        <span class="value">{{ item.theirs }}</span>
                      </label>
                    </div>
                  }
                </div>
              } @else {
                <div class="conflict" role="radiogroup" [attr.aria-label]="conflict.name">
                  <span class="name">{{ conflict.name }}</span>
                  <label><input type="radio" [name]="conflict.path" [checked]="choices()[conflict.path] === 'mine'" (change)="choose(conflict, 'mine')" /> Mine</label>
                  <label><input type="radio" [name]="conflict.path" [checked]="choices()[conflict.path] === 'theirs'" (change)="choose(conflict, 'theirs')" /> Theirs</label>
                </div>
              }
            }
          </fieldset>
        }
        @if (outcome(); as message) {
          <p class="outcome" role="status">{{ message }}</p>
        }
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions">
          @if (shared()) {
            <button type="button" class="btn btn-ghost stop" (click)="stopSharing()">Stop syncing</button>
          }
          <button type="button" class="btn" (click)="dialog.close()">Close</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !url().trim() || !chosen()">
            {{ busy() ? 'Syncing…' : conflicts().length ? 'Sync with these choices' : 'Sync' }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    .sync { width: min(520px, calc(100vw - 32px)); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    .conflicts { display: grid; gap: var(--space-2); margin: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); }
    legend { padding: 0 var(--space-1); font-size: 12px; color: var(--text-muted); }
    .conflict { display: flex; align-items: center; gap: var(--space-3); }
    .conflict .name { flex: 1; min-width: 0; font-weight: 500; overflow-wrap: anywhere; }
    .conflict label { display: flex; align-items: center; gap: var(--space-1); font-size: 13px; }
    .conflicts { max-height: 46vh; overflow: auto; }
    .items { display: grid; gap: var(--space-2); }
    .items .name { font-weight: 500; }
    .item { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-1) var(--space-2); padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); }
    .item-name { grid-column: 1 / -1; font-size: 13px; font-weight: 500; }
    .side { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 2px var(--space-1); padding: var(--space-1); border-radius: var(--radius); background: var(--surface-raised); font-size: 12px; }
    .side .value { grid-column: 2; color: var(--text-muted); overflow-wrap: anywhere; }
    .outcome { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--accent-soft); color: var(--accent-strong); font-size: 12px; }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
    .stop { margin-right: auto; }
  `,
})
export class SyncDialog {
  /** The project (or where it is synced) may have changed: what shows it should load it again. */
  readonly synced = output();
  protected readonly url = signal('');
  protected readonly corsProxy = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly shared = signal(false);
  protected readonly busy = signal(false);
  protected readonly outcome = signal<string | undefined>(undefined);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly conflicts = signal<readonly SyncConflict[]>([]);
  protected readonly choices = signal<Readonly<Record<string, ConflictChoice>>>({});
  protected readonly chosen = computed(() =>
    this.conflicts().every((c) => (c.items?.length ? c.items.every((item) => this.choices()[this.itemKey(c, item)]) : this.choices()[c.path])),
  );
  private project: ProjectSummary | undefined;
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly signIns = inject(RemoteSignIns);
  private readonly accounts = inject(ServerAccounts);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  open(project: ProjectSummary): void {
    this.project = project;
    const url = project.remote?.url ?? '';
    const credentials = this.signIns.get(url);
    this.url.set(url);
    this.corsProxy.set(project.remote?.corsProxy ?? '');
    this.username.set(credentials?.username ?? '');
    this.password.set(credentials?.password ?? '');
    this.shared.set(!!project.remote);
    this.reset();
    this.dialog().nativeElement.showModal();
  }

  /** How an item's choice is given to the sync: the document's path, then the item's (CAD-176). */
  protected itemKey(conflict: SyncConflict, item: ItemConflict): string {
    return `${conflict.path}#${item.path}`;
  }

  protected chooseItem(conflict: SyncConflict, item: ItemConflict, choice: ConflictChoice): void {
    this.choices.update((choices) => ({ ...choices, [this.itemKey(conflict, item)]: choice }));
  }

  protected choose(conflict: SyncConflict, choice: ConflictChoice): void {
    this.choices.update((choices) => ({ ...choices, [conflict.path]: choice }));
  }

  protected async sync(): Promise<void> {
    const project = this.project;
    if (!project) return;
    this.busy.set(true);
    try {
      const url = this.url().trim();
      const corsProxy = this.corsProxy().trim();
      const remote = { url, ...(corsProxy ? { corsProxy } : {}) };
      if (url !== project.remote?.url || corsProxy !== (project.remote?.corsProxy ?? '')) {
        const saved = await this.projects.setRemote(project.id, remote);
        if (!saved.ok) return this.failed(saved.error.message);
        this.project = { ...project, remote };
        this.shared.set(true);
      }
      // A project on a CADence server syncs with the sign-in there (or its view link, which the Project Manager knows).
      const server = this.project?.remote?.server;
      const account = server && !server.link ? this.accounts.signInFor(server.url) : undefined;
      const credentials = credentialsOf(this.username(), this.password()) ?? (account ? { username: 'token', password: account.token } : undefined);
      const result = await this.projects.syncProject(project.id, credentials, this.choices());
      if (!result.ok) return this.failed(result.error.message);
      this.signIns.remember(url, credentials);
      this.reset();
      if (result.value.kind === 'conflicts') return this.conflicts.set(result.value.conflicts);
      const names = result.value.nameConflicts ?? [];
      this.outcome.set(
        names.length
          ? `${outcomes[result.value.kind]} The repository gives the names ${names.join(', ')} to other versions; here they stay as they are.`
          : outcomes[result.value.kind],
      );
      this.synced.emit();
    } finally {
      this.busy.set(false);
    }
  }

  protected async stopSharing(): Promise<void> {
    if (!this.project) return;
    await this.projects.setRemote(this.project.id, undefined);
    const { remote: _, ...rest } = this.project;
    this.project = rest;
    this.shared.set(false);
    this.url.set('');
    this.corsProxy.set('');
    this.reset();
    this.outcome.set('This project is no longer synced. Its versions stay here and in the repository.');
    this.synced.emit();
  }

  private reset(): void {
    this.outcome.set(undefined);
    this.error.set(undefined);
    this.conflicts.set([]);
    this.choices.set({});
  }

  private failed(message: string): void {
    this.outcome.set(undefined);
    this.error.set(message);
  }
}
