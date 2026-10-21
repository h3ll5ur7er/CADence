import type { LiveEvent, LivePayload, LiveWhere, ProjectRole, ServerInfo, ServerSignIn, ServerUser, SharedProject } from '@core/contracts';
import { type LiveConnection, type LiveListener, type LiveRoom, ServerError, type ServerAccess, type ServerProblem } from './server-access';

const problems: Readonly<Record<number, ServerProblem>> = { 401: 'unauthorized', 403: 'forbidden', 404: 'not-found' };
/** Waits before connecting again, growing to the last. */
const retries = [500, 1000, 2000, 5000, 10_000];

const base = (server: string) => server.replace(/\/+$/, '');

/** A CADence server over HTTP: its JSON API, and its relay as server-sent events read with `fetch`. */
export class HttpServerAccess implements ServerAccess {
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}

  private async call<T>(server: string, path: string, token?: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${base(server)}${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (error) {
      throw new ServerError('unreachable', `The CADence server at ${server} cannot be reached (${error instanceof Error ? error.message : String(error)}).`);
    }
    const answer = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!response.ok) throw new ServerError(problems[response.status] ?? 'rejected', answer.error?.message ?? `The server answered ${response.status}.`);
    return answer;
  }

  info(server: string): Promise<ServerInfo> {
    return this.call(server, '/api/info');
  }

  async signInByName(server: string, name: string): Promise<ServerSignIn> {
    const { token } = await this.call<{ token: string }>(server, '/api/sign-in', undefined, { body: { name } });
    return { server: base(server), token };
  }

  user(signIn: ServerSignIn): Promise<ServerUser> {
    return this.call(signIn.server, '/api/me', signIn.token);
  }

  async signOut(signIn: ServerSignIn): Promise<void> {
    await this.call(signIn.server, '/api/sign-out', signIn.token, { body: {} });
  }

  projects(signIn: ServerSignIn): Promise<SharedProject[]> {
    return this.call(signIn.server, '/api/projects', signIn.token);
  }

  createProject(signIn: ServerSignIn, name: string): Promise<SharedProject> {
    return this.call(signIn.server, '/api/projects', signIn.token, { body: { name } });
  }

  project(signIn: ServerSignIn, id: string): Promise<SharedProject> {
    return this.call(signIn.server, `/api/projects/${encodeURIComponent(id)}`, signIn.token);
  }

  setMember(signIn: ServerSignIn, id: string, who: string, role: ProjectRole): Promise<SharedProject> {
    return this.call(signIn.server, `/api/projects/${encodeURIComponent(id)}/members`, signIn.token, { body: { user: who, role } });
  }

  removeMember(signIn: ServerSignIn, id: string, userId: string): Promise<SharedProject> {
    return this.call(signIn.server, `/api/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, signIn.token, { method: 'DELETE' });
  }

  addLink(signIn: ServerSignIn, id: string): Promise<SharedProject> {
    return this.call(signIn.server, `/api/projects/${encodeURIComponent(id)}/links`, signIn.token, { body: {} });
  }

  removeLink(signIn: ServerSignIn, id: string, token: string): Promise<SharedProject> {
    return this.call(signIn.server, `/api/projects/${encodeURIComponent(id)}/links/${encodeURIComponent(token)}`, signIn.token, { method: 'DELETE' });
  }

  link(server: string, token: string): Promise<{ project: { id: string; name: string }; git: string }> {
    return this.call(server, `/api/links/${encodeURIComponent(token)}`);
  }

  join(room: LiveRoom, listener: LiveListener): LiveConnection {
    const path = `/live/${encodeURIComponent(room.project)}/${encodeURIComponent(room.document)}`;
    let closed = false;
    let controller: AbortController | undefined;
    let attempt = 0;
    const listen = async (): Promise<void> => {
      while (!closed) {
        listener.status('connecting');
        controller = new AbortController();
        try {
          const response = await this.fetcher(`${base(room.server)}${path}?client=${encodeURIComponent(room.clientId)}&after=${listener.after()}`, {
            headers: { Authorization: `Bearer ${room.token}`, Accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`answered ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let first = true;
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let end: number;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const message = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              if (!message.startsWith('data: ')) continue;
              if (first) {
                first = false;
                attempt = 0;
                listener.status('live');
              }
              listener.event(JSON.parse(message.slice(6)) as LiveEvent);
            }
          }
        } catch {
          // Offline, or closed: tried again below unless closed.
        }
        if (closed) return;
        listener.status('offline');
        await new Promise((resolve) => setTimeout(resolve, retries[Math.min(attempt++, retries.length - 1)]));
      }
    };
    void listen();
    return {
      send: async (payload: LivePayload) => (await this.call<{ seq: number }>(room.server, path, room.token, { body: { clientId: room.clientId, payload } })).seq,
      present: async (where: LiveWhere) => {
        await this.call(room.server, `${path}/presence`, room.token, { body: { clientId: room.clientId, where } });
      },
      snapshot: async (seq: number, document: unknown) => (await this.call<{ kept: boolean }>(room.server, `${path}/snapshot`, room.token, { body: { clientId: room.clientId, seq, document } })).kept,
      reconnect: () => controller?.abort(),
      close: () => {
        closed = true;
        controller?.abort();
      },
    };
  }
}
