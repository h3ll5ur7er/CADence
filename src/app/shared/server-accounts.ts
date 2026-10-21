import { Injectable, signal } from '@angular/core';
import type { ServerSignIn, ServerUser } from '@core/contracts';

/** A sign-in to a CADence server, with who it is. */
export interface ServerAccount extends ServerSignIn {
  readonly user?: ServerUser;
}

const storageKey = 'cadence.servers';

function load(): ServerAccount[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as ServerAccount[];
  } catch {
    return [];
  }
}

/**
 * The CADence servers this browser is signed in to (CAD-177), kept on this device like any web app's
 * sign-in. A server sends people back from signing in with the sign-in in the address's fragment,
 * which `captureServerSignIn` takes and removes.
 */
@Injectable({ providedIn: 'root' })
export class ServerAccounts {
  readonly accounts = signal<readonly ServerAccount[]>(load());

  /** The server last signed in to, to offer first. */
  latest(): ServerAccount | undefined {
    return this.accounts()[0];
  }

  signInFor(server: string): ServerAccount | undefined {
    return this.accounts().find((a) => a.server === trimmed(server));
  }

  remember(account: ServerAccount): void {
    this.save([{ ...account, server: trimmed(account.server) }, ...this.accounts().filter((a) => a.server !== trimmed(account.server))]);
  }

  forget(server: string): void {
    this.save(this.accounts().filter((a) => a.server !== trimmed(server)));
  }

  private save(accounts: readonly ServerAccount[]): void {
    this.accounts.set(accounts);
    try {
      localStorage.setItem(storageKey, JSON.stringify(accounts));
    } catch {
      // Private windows: kept while the app is open.
    }
  }
}

const trimmed = (server: string) => server.trim().replace(/\/+$/, '');

/**
 * Takes a sign-in a server sent back in the address (`#cadence-server=…&cadence-token=…`) out of it
 * and keeps it, before the router reads the address.
 */
export function captureServerSignIn(location: Location = window.location, history: History = window.history): void {
  const values = new URLSearchParams(location.hash.slice(1));
  const server = values.get('cadence-server');
  const token = values.get('cadence-token');
  if (!server || !token) return;
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  const signIn = { server: trimmed(server), token };
  try {
    localStorage.setItem(storageKey, JSON.stringify([signIn, ...load().filter((a) => a.server !== signIn.server)]));
  } catch {
    // Private windows keep nothing: signing in again is needed.
  }
}
