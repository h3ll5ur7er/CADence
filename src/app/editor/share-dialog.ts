import { ChangeDetectionStrategy, Component, computed, effect, type ElementRef, inject, output, signal, untracked, viewChild } from '@angular/core';
import type { ProjectRole, ProjectSummary, Result, SharedProject } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { ServerAccounts } from '../shared/server-accounts';
import { ServerSignIn } from '../shared/server-sign-in';

const roles: readonly { readonly role: ProjectRole; readonly label: string }[] = [
  { role: 'viewer', label: 'Can view' },
  { role: 'editor', label: 'Can edit' },
  { role: 'owner', label: 'Owner' },
];

/**
 * Shares a project on a CADence server (CAD-177): puts it there, invites members to view or edit it,
 * and makes links that let anyone view it in the browser.
 */
@Component({
  selector: 'cad-share-dialog',
  imports: [ServerSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../shared/dialogs.scss',
  template: `
    <dialog #dialog class="dialog share" aria-labelledby="share-heading">
      @if (project(); as p) {
        <h2 id="share-heading">Share {{ p.name }}</h2>
        <p class="hint">A project on a CADence server is synced there; its members open it on their devices and edit it together, live.</p>
        <cad-server-sign-in [(server)]="server" />
        @if (account()?.user) {
          @if (!p.remote?.server) {
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="share()">{{ busy() ? 'Putting it on the server…' : 'Share on this server' }}</button>
          } @else if (p.remote?.server?.url !== server()) {
            <p class="hint">This project is shared on {{ p.remote?.server?.url }}: sign in there to change who it is shared with.</p>
          } @else if (shared(); as s) {
            <section aria-label="Members">
              <p class="eyebrow">Members</p>
              <ul class="members">
                @for (member of s.members ?? []; track member.id) {
                  <li>
                    <span class="who">{{ member.name }}@if (member.email) {<span class="email">{{ member.email }}</span>}</span>
                    @if (s.role === 'owner') {
                      <select [attr.aria-label]="'Role of ' + member.name" (change)="setMember(member.id, $any($event.target).value)">
                        @for (r of roles; track r.role) {
                          <option [value]="r.role" [selected]="r.role === member.role">{{ r.label }}</option>
                        }
                      </select>
                      <button type="button" class="btn btn-ghost" [attr.aria-label]="'Remove ' + member.name" (click)="removeMember(member.id)">Remove</button>
                    } @else {
                      <span class="role">{{ roleLabel(member.role) }}</span>
                    }
                  </li>
                }
              </ul>
              @if (s.role === 'owner') {
                <form class="invite" (submit)="$event.preventDefault(); invite(who.value, inviteRole.value); who.value = ''">
                  <input #who aria-label="Name or e-mail address to invite" placeholder="Name or e-mail of someone who signed in here" />
                  <select #inviteRole aria-label="Role of the new member">
                    <option value="editor">Can edit</option>
                    <option value="viewer">Can view</option>
                  </select>
                  <button type="submit" class="btn">Invite</button>
                </form>
              }
            </section>
            @if (s.role === 'owner') {
              <section aria-label="View links">
                <p class="eyebrow">Links to view</p>
                <p class="hint">Anyone with such a link opens the project in their browser to look at it, without an account.</p>
                @for (link of s.links ?? []; track link.token) {
                  <div class="link">
                    <input readonly aria-label="Link to view" data-testid="view-link" [value]="linkUrl(link.token)" (focus)="$any($event.target).select()" />
                    <button type="button" class="btn btn-ghost" (click)="copy(link.token)">Copy</button>
                    <button type="button" class="btn btn-ghost" [attr.aria-label]="'Stop the link'" (click)="removeLink(link.token)">Stop</button>
                  </div>
                }
                <button type="button" class="btn" (click)="addLink()">Make a link to view</button>
              </section>
            }
          }
        }
        @if (error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }
        <div class="actions">
          <button type="button" class="btn btn-primary" (click)="dialog.close()">Close</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .share { width: min(560px, calc(100vw - 32px)); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
    section { display: grid; gap: var(--space-2); margin-top: var(--space-3); }
    .members { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
    .members li { display: flex; align-items: center; gap: var(--space-2); }
    .who { flex: 1; display: flex; flex-direction: column; font-weight: 500; }
    .email { color: var(--text-muted); font-size: 11px; font-weight: 400; }
    .role { color: var(--text-muted); font-size: 12px; }
    .invite, .link { display: flex; gap: var(--space-2); }
    .invite input, .link input { flex: 1; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-raised); color: var(--text); }
    select { height: 32px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-raised); color: var(--text); }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
    .actions { display: flex; justify-content: flex-end; }
  `,
})
export class ShareDialog {
  /** The project went on a server (its remote changed): what shows it should load it again. */
  readonly changed = output();
  protected readonly project = signal<ProjectSummary | undefined>(undefined);
  protected readonly server = signal('');
  protected readonly shared = signal<SharedProject | undefined>(undefined);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  protected readonly roles = roles;
  private readonly projects = inject(PROJECT_MANAGER);
  private readonly accounts = inject(ServerAccounts);
  protected readonly account = computed(() => (this.server() ? this.accounts.signInFor(this.server()) : undefined));
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    // Signed in (here, or back from a provider): the members and links of a shared project.
    effect(() => {
      if (this.account()?.user) void untracked(() => this.load());
    });
  }

  async open(project: ProjectSummary): Promise<void> {
    this.project.set(project);
    this.error.set(undefined);
    this.shared.set(undefined);
    this.server.set(project.remote?.server?.url ?? this.accounts.latest()?.server ?? '');
    this.dialog().nativeElement.showModal();
    await this.load();
  }

  protected roleLabel(role: ProjectRole): string {
    return roles.find((r) => r.role === role)?.label ?? role;
  }

  protected linkUrl(token: string): string {
    const url = new URL('shared', document.baseURI);
    url.search = new URLSearchParams({ server: this.server(), link: token }).toString();
    return url.toString();
  }

  protected async share(): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (!project || !account) return;
    this.busy.set(true);
    try {
      if (this.show(await this.projects.shareProject(project.id, account))) {
        this.project.set((await this.projects.findProject(project.id)) ?? project);
        this.changed.emit();
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async invite(who: string, role: string): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (project && account && who.trim()) this.show(await this.projects.setMember(project.id, account, who.trim(), role as ProjectRole));
  }

  protected async setMember(userId: string, role: string): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (project && account) this.show(await this.projects.setMember(project.id, account, userId, role as ProjectRole));
  }

  protected async removeMember(userId: string): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (project && account) this.show(await this.projects.removeMember(project.id, account, userId));
  }

  protected async addLink(): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (project && account) this.show(await this.projects.addViewLink(project.id, account));
  }

  protected async removeLink(token: string): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (project && account) this.show(await this.projects.removeViewLink(project.id, account, token));
  }

  protected copy(token: string): void {
    void navigator.clipboard?.writeText(this.linkUrl(token)).catch(() => undefined);
  }

  private async load(): Promise<void> {
    const [project, account] = [this.project(), this.account()];
    if (project?.remote?.server && account?.user && project.remote.server.url === account.server) this.show(await this.projects.sharing(project.id, account));
  }

  private show(result: Result<SharedProject>): boolean {
    this.error.set(result.ok ? undefined : result.error.message);
    if (result.ok) this.shared.set(result.value);
    return result.ok;
  }
}
