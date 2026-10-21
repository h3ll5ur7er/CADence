import { ChangeDetectionStrategy, Component, computed, effect, inject, model, signal, untracked } from '@angular/core';
import type { ServerInfo } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { type ServerAccount, ServerAccounts } from './server-accounts';

/**
 * Signing in to a CADence server (CAD-177): its address, then its ways to sign in (GitHub, Google, or a
 * name on private servers), or who is signed in there.
 */
@Component({
  selector: 'cad-server-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './dialogs.scss',
  template: `
    <div class="sign-in">
      <label class="field">
        CADence server
        <span class="row">
          <input type="url" aria-label="CADence server address" placeholder="https://cadence.example.org" autocomplete="url" [value]="server()" (change)="server.set($any($event.target).value.trim())" />
          @if (!account()?.user) {
            <button type="button" class="btn" [disabled]="!server() || busy()" (click)="connect()">Connect</button>
          }
        </span>
      </label>
      @if (account()?.user; as user) {
        <p class="signed-in" data-testid="signed-in">
          Signed in as <strong>{{ user.name }}</strong>
          <button type="button" class="btn btn-ghost" (click)="signOut()">Sign out</button>
        </p>
      } @else if (info(); as found) {
        <div class="ways">
          @for (provider of found.providers; track provider.id) {
            @if (provider.id === 'dev') {
              <form class="row" (submit)="$event.preventDefault(); signInByName(nameInput.value)">
                <input #nameInput aria-label="Your name" placeholder="Your name" autocomplete="name" />
                <button type="submit" class="btn btn-primary" [disabled]="busy()">Sign in</button>
              </form>
            } @else {
              <button type="button" class="btn btn-primary" (click)="signInWith(provider.id)">Sign in with {{ provider.label }}</button>
            }
          }
        </div>
      }
      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </div>
  `,
  styles: `
    .sign-in { display: grid; gap: var(--space-2); }
    .field { display: grid; gap: var(--space-1); font-size: 12px; color: var(--text-muted); }
    .row { display: flex; gap: var(--space-2); }
    .row input { flex: 1; min-width: 0; height: 32px; padding: 0 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-raised); color: var(--text); }
    .signed-in { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 13px; }
    .ways { display: grid; gap: var(--space-2); }
    .error { margin: 0; padding: var(--space-2); border-radius: var(--radius); background: var(--danger-soft); color: var(--danger); font-size: 12px; overflow-wrap: anywhere; }
  `,
})
export class ServerSignIn {
  /** The server's address. */
  readonly server = model('');
  protected readonly info = signal<ServerInfo | undefined>(undefined);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | undefined>(undefined);
  private readonly accounts = inject(ServerAccounts);
  private readonly projects = inject(PROJECT_MANAGER);
  protected readonly account = computed((): ServerAccount | undefined => (this.server() ? this.accounts.signInFor(this.server()) : undefined));

  constructor() {
    untracked(() => this.server.set(this.server() || (this.accounts.latest()?.server ?? '')));
    // Back from a provider, the sign-in has no user yet: ask the server who it is.
    effect(() => {
      const account = this.account();
      if (account && !account.user) void untracked(() => this.identify(account));
    });
  }

  private async identify(account: ServerAccount): Promise<void> {
    const user = await this.projects.serverUser(account);
    if (user.ok) this.accounts.remember({ ...account, user: user.value });
    else {
      this.accounts.forget(account.server);
      this.error.set(user.error.message);
    }
  }

  protected async connect(): Promise<void> {
    this.busy.set(true);
    this.error.set(undefined);
    try {
      const info = await this.projects.serverInfo(this.server());
      if (info.ok) this.info.set(info.value);
      else this.error.set(info.error.message);
    } finally {
      this.busy.set(false);
    }
  }

  protected signInWith(provider: string): void {
    const server = this.server().replace(/\/+$/, '');
    window.location.href = `${server}/auth/${provider}?return=${encodeURIComponent(window.location.href)}`;
  }

  protected async signInByName(name: string): Promise<void> {
    if (!name.trim()) return;
    this.busy.set(true);
    try {
      const signIn = await this.projects.signInByName(this.server(), name.trim());
      if (!signIn.ok) return this.error.set(signIn.error.message);
      const user = await this.projects.serverUser(signIn.value);
      if (!user.ok) return this.error.set(user.error.message);
      this.accounts.remember({ ...signIn.value, user: user.value });
      this.server.set(signIn.value.server);
      this.error.set(undefined);
    } finally {
      this.busy.set(false);
    }
  }

  protected async signOut(): Promise<void> {
    const account = this.account();
    if (!account) return;
    await this.projects.signOut(account);
    this.accounts.forget(account.server);
    this.info.set(undefined);
  }
}
