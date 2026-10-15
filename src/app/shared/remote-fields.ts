import { ChangeDetectionStrategy, Component, Injectable, model } from '@angular/core';
import type { RemoteCredentials } from '@core/contracts';

/** Sign-ins for git remotes, by address: kept in memory while CADence is open, never saved. */
@Injectable({ providedIn: 'root' })
export class RemoteSignIns {
  private readonly byUrl = new Map<string, RemoteCredentials>();

  get(url: string): RemoteCredentials | undefined {
    return this.byUrl.get(url);
  }

  remember(url: string, credentials: RemoteCredentials | undefined): void {
    if (credentials) this.byUrl.set(url, credentials);
    else this.byUrl.delete(url);
  }
}

/** The address of a git remote, an optional CORS proxy and the sign-in for it. */
@Component({
  selector: 'cad-remote-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="field">
      Repository address
      <input #urlInput name="url" type="url" autocomplete="off" placeholder="https://github.com/you/project.git" [value]="url()" (input)="url.set(urlInput.value)" />
    </label>
    <label class="field">
      CORS proxy (browsers need one for most hosts)
      <input #proxyInput name="corsProxy" type="url" autocomplete="off" placeholder="https://cors.isomorphic-git.org" [value]="corsProxy()" (input)="corsProxy.set(proxyInput.value)" />
    </label>
    <div class="sign-in">
      <label class="field">
        User name
        <input #userInput name="username" autocomplete="off" [value]="username()" (input)="username.set(userInput.value)" />
      </label>
      <label class="field">
        Password or access token
        <input #passwordInput name="password" type="password" autocomplete="off" [value]="password()" (input)="password.set(passwordInput.value)" />
      </label>
    </div>
    <p class="hint">The sign-in is kept only while CADence is open; it is never saved.</p>
  `,
  styles: `
    :host { display: grid; gap: var(--space-3); }
    .sign-in { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    .hint { margin: 0; color: var(--text-muted); font-size: 12px; }
  `,
})
export class RemoteFields {
  readonly url = model('');
  readonly corsProxy = model('');
  readonly username = model('');
  readonly password = model('');
}

/** The sign-in typed into remote fields, when there is one. */
export const credentialsOf = (username: string, password: string): RemoteCredentials | undefined =>
  username || password ? { username, password } : undefined;
