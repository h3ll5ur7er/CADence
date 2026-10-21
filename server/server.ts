import { mkdirSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { LivePayload, LiveUser, LiveWhere } from '@core/contracts';
import { createRepository, gitAvailable, isPush, serveGit } from './git';
import { Relay } from './relay';
import { authorizeAt, exchange, type OAuthProvider } from './sign-in';
import { atLeast, newToken, type Role, type ServerProject, Store, type User } from './store';

/** How a CADence server runs (docs/Architecture/Decisions.md#adr-61a). */
export interface ServerConfig {
  /** Where accounts and projects are kept: `server.json` and `repos/<project>.git`. */
  readonly data: string;
  /** How browsers reach the server (sign-in return addresses, git addresses); the listening address by default. */
  readonly publicUrl?: string;
  readonly providers: readonly OAuthProvider[];
  /** Signing in by name alone, without a provider: for tests and for a server on a private network. */
  readonly devSignIn?: boolean;
  /** Where the app may run (browsers' cross-origin requests, sign-in return addresses); every origin by default. */
  readonly origins?: readonly string[];
}

export interface RunningServer {
  readonly url: string;
  readonly store: Store;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const palette = ['#e8590c', '#1c7ed6', '#2f9e44', '#ae3ec9', '#f08c00', '#0c8599', '#d6336c', '#5c940d'];
const colorOf = (id: string) => palette[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % palette.length] as string;
const liveUser = (user: User | undefined, role: Role): LiveUser => (user ? { id: user.id, name: user.name, color: colorOf(user.id) } : { id: 'link', name: role === 'viewer' ? 'Viewer' : 'Guest', color: '#868e96' });

const bodyLimit = 32 * 1024 * 1024;

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > bodyLimit) throw new HttpError(413, 'too-large', 'The request is too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readText(request);
  if (!text) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Answered below.
  }
  throw new HttpError(400, 'invalid-request', 'The request is not a JSON object.');
}

const reply = (response: ServerResponse, status: number, value: unknown) => {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
};

/** The bearer token of a request: `Authorization: Bearer`, the password of basic auth (git), or `?token=`. */
function tokenOf(request: IncomingMessage, url: URL): string | undefined {
  const header = request.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (header.startsWith('Basic ')) return Buffer.from(header.slice(6), 'base64').toString().split(':').slice(1).join(':') || undefined;
  return url.searchParams.get('token') ?? undefined;
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>` +
  `<style>body{font:15px system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 16px;color:#1f2328}input,button{font:inherit;padding:8px 10px}input{width:100%;box-sizing:border-box;margin:8px 0}button{cursor:pointer}</style></head><body>${body}</body></html>`;
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A CADence server: accounts, projects shared as git repositories, and the live relay (CAD-177, CAD-178). */
export async function startServer(config: ServerConfig, port = 0, host = '127.0.0.1'): Promise<RunningServer> {
  if (!gitAvailable()) throw new Error('The CADence server needs git on its PATH: it keeps projects as git repositories.');
  const store = new Store(config.data);
  const repositories = join(config.data, 'repos');
  mkdirSync(repositories, { recursive: true });
  const relay = new Relay();
  /** Sign-ins under way, by the state sent to the provider. */
  const pending = new Map<string, { readonly provider: string; readonly back: string; readonly until: number }>();
  let base = config.publicUrl ?? '';

  const allowedOrigin = (origin: string | undefined) => !config.origins || (origin !== undefined && config.origins.includes(origin));
  /** Where a sign-in may send people back to: the app, on an allowed origin. */
  const returnAddress = (value: string | null): string => {
    try {
      const url = new URL(value ?? '');
      if ((url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tauri:') && allowedOrigin(url.origin)) return url.toString();
    } catch {
      // Refused below.
    }
    throw new HttpError(400, 'invalid-return', 'Sign-in can only send you back to the CADence app.');
  };
  /** Back to the app with the sign-in, in the address's fragment (never sent to any server). */
  const signedInAt = (back: string, user: User) => {
    const url = new URL(back);
    url.hash = new URLSearchParams({ 'cadence-server': base, 'cadence-token': store.startSession(user) }).toString();
    return url.toString();
  };

  const signedInUser = (request: IncomingMessage, url: URL): User => {
    const user = store.userOf(tokenOf(request, url));
    if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to the CADence server first.');
    return user;
  };
  const projectFor = (id: string, request: IncomingMessage, url: URL, needed: Role): { project: ServerProject; role: Role; user?: User } => {
    const project = store.project(id);
    const access = project ? store.roleOf(project, tokenOf(request, url)) : undefined;
    if (!project || !access) throw new HttpError(tokenOf(request, url) ? 404 : 401, tokenOf(request, url) ? 'unknown-project' : 'unauthorized', 'No such project here, or it is not shared with you.');
    if (!atLeast(access.role, needed)) throw new HttpError(403, 'forbidden', `This needs a project's ${needed === 'owner' ? 'owner' : 'editors'}; it is shared with you to ${access.role === 'viewer' ? 'view' : 'edit'}.`);
    return { project, ...access };
  };
  const gitUrl = (project: ServerProject) => `${base}/git/${project.id}.git`;
  const describeProject = (project: ServerProject, role: Role) => ({
    id: project.id,
    name: project.name,
    role,
    git: gitUrl(project),
    ...(atLeast(role, 'editor')
      ? { members: Object.entries(project.members).flatMap(([id, r]) => (store.user(id) ? [{ id, name: store.user(id)?.name, role: r, ...(store.user(id)?.email ? { email: store.user(id)?.email } : {}) }] : [])) }
      : {}),
    ...(role === 'owner' ? { links: Object.entries(project.links).map(([token, link]) => ({ token, ...link })) } : {}),
  });

  async function route(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const method = request.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [area, first, second, third] = parts;

    if (area === 'git' && first?.endsWith('.git')) {
      const id = first.slice(0, -4);
      const { role, user } = projectFor(id, request, url, isPush(url) ? 'editor' : 'viewer');
      return serveGit(repositories, url.pathname.slice('/git'.length), url.search.slice(1), user?.id ?? `link:${role}`, request, response);
    }

    if (area === 'auth') {
      if (first === 'dev' && config.devSignIn) {
        if (method === 'GET') {
          const back = returnAddress(url.searchParams.get('return'));
          return void response
            .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(page('Sign in', `<h1>Sign in to CADence</h1><form method="post"><input type="hidden" name="return" value="${escape(back)}"><label>Your name<input name="name" required autofocus></label><button>Sign in</button></form>`));
        }
        const form = new URLSearchParams(await readText(request));
        const name = form.get('name')?.trim();
        if (!name) throw new HttpError(400, 'invalid-name', 'Give a name to sign in with.');
        const back = returnAddress(form.get('return'));
        return void response.writeHead(303, { Location: signedInAt(back, store.signedIn(`dev:${name.toLowerCase()}`, name)) }).end();
      }
      const provider = config.providers.find((p) => p.id === first);
      if (!provider) throw new HttpError(404, 'unknown-provider', 'This server does not offer that sign-in.');
      const redirect = `${base}/auth/${provider.id}/callback`;
      if (second !== 'callback') {
        const state = newToken();
        pending.set(state, { provider: provider.id, back: returnAddress(url.searchParams.get('return')), until: Date.now() + 10 * 60_000 });
        return void response.writeHead(302, { Location: authorizeAt(provider, redirect, state) }).end();
      }
      const state = url.searchParams.get('state') ?? '';
      const started = pending.get(state);
      pending.delete(state);
      if (!started || started.provider !== provider.id || started.until < Date.now()) throw new HttpError(400, 'expired', 'This sign-in took too long or was not started here: try again.');
      const who = await provider.identify(await exchange(provider, url.searchParams.get('code') ?? '', redirect));
      return void response.writeHead(303, { Location: signedInAt(started.back, store.signedIn(`${provider.id}:${who.id}`, who.name, who.email)) }).end();
    }

    if (area === 'live' && first && second) {
      const { project, role, user } = projectFor(first, request, url, third === 'snapshot' || (method === 'POST' && !third) ? 'editor' : 'viewer');
      const live = liveUser(user, role);
      if (method === 'GET') return relay.listen(project.id, second, url.searchParams.get('client') ?? newToken(), live, Number(url.searchParams.get('after') ?? -1), response);
      const body = await readJson(request);
      const clientId = String(body['clientId'] ?? '');
      if (!clientId) throw new HttpError(400, 'invalid-request', 'Say which client sends this (clientId).');
      if (third === 'presence') {
        relay.presence(project.id, second, clientId, live, (body['where'] ?? {}) as LiveWhere);
        return reply(response, 200, {});
      }
      if (third === 'snapshot') return reply(response, 200, { kept: relay.keepSnapshot(project.id, second, Number(body['seq']), body['document']) });
      const payload = body['payload'] as LivePayload | undefined;
      if (payload?.kind !== 'command' && payload?.kind !== 'document') throw new HttpError(400, 'invalid-request', 'Send a command or a document.');
      return reply(response, 200, { seq: relay.append(project.id, second, clientId, live, payload) });
    }

    if (area !== 'api') throw new HttpError(404, 'not-found', 'Nothing here.');
    if (first === 'info') {
      return reply(response, 200, { name: 'CADence server', providers: [...config.providers.map((p) => ({ id: p.id, label: p.label })), ...(config.devSignIn ? [{ id: 'dev', label: 'Name only' }] : [])] });
    }
    if (first === 'sign-in' && method === 'POST' && config.devSignIn) {
      const name = String((await readJson(request))['name'] ?? '').trim();
      if (!name) throw new HttpError(400, 'invalid-name', 'Give a name to sign in with.');
      const user = store.signedIn(`dev:${name.toLowerCase()}`, name);
      return reply(response, 200, { token: store.startSession(user), user });
    }
    if (first === 'links' && second) {
      const project = store.projectOfLink(second);
      if (!project) throw new HttpError(404, 'unknown-link', 'This link is not (or no longer) shared.');
      return reply(response, 200, { project: { id: project.id, name: project.name }, role: 'viewer', git: gitUrl(project) });
    }
    const user = signedInUser(request, url);
    if (first === 'me') return reply(response, 200, { id: user.id, name: user.name, ...(user.email ? { email: user.email } : {}) });
    if (first === 'sign-out' && method === 'POST') {
      store.endSession(tokenOf(request, url) ?? '');
      return reply(response, 200, {});
    }
    if (first !== 'projects') throw new HttpError(404, 'not-found', 'Nothing here.');
    if (!second) {
      if (method === 'GET') return reply(response, 200, store.projectsOf(user).map((p) => describeProject(p, p.members[user.id] as Role)));
      const name = String((await readJson(request))['name'] ?? '').trim();
      if (!name) throw new HttpError(400, 'invalid-name', 'A project needs a name.');
      const project = store.createProject(user, name);
      createRepository(repositories, project.id);
      return reply(response, 201, describeProject(project, 'owner'));
    }
    if (!third) {
      const { project, role } = projectFor(second, request, url, 'viewer');
      return reply(response, 200, describeProject(project, role));
    }
    const { project } = projectFor(second, request, url, 'owner');
    const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(request);
    if (third === 'members') {
      const who = parts[4];
      if (method === 'DELETE' && who) {
        if (project.members[who] === 'owner' && Object.values(project.members).filter((r) => r === 'owner').length === 1) {
          throw new HttpError(409, 'last-owner', 'A project keeps at least one owner.');
        }
        const { [who]: _, ...members } = project.members;
        store.revise({ ...project, members });
        return reply(response, 200, describeProject(store.project(project.id) as ServerProject, 'owner'));
      }
      const member = store.findUser(String(body['user'] ?? who ?? ''));
      if (!member) throw new HttpError(404, 'unknown-user', 'Nobody of that name or e-mail address has signed in to this server yet.');
      const role = body['role'];
      if (role !== 'owner' && role !== 'editor' && role !== 'viewer') throw new HttpError(400, 'invalid-role', 'A member is an owner, an editor or a viewer.');
      store.revise({ ...project, members: { ...project.members, [member.id]: role } });
      return reply(response, 200, describeProject(store.project(project.id) as ServerProject, 'owner'));
    }
    if (third === 'links') {
      const token = parts[4];
      if (method === 'DELETE' && token) {
        const { [token]: _, ...links } = project.links;
        store.revise({ ...project, links });
      } else {
        store.revise({ ...project, links: { ...project.links, [newToken()]: { role: 'viewer', createdAt: new Date().toISOString() } } });
      }
      return reply(response, 200, describeProject(store.project(project.id) as ServerProject, 'owner'));
    }
    throw new HttpError(404, 'not-found', 'Nothing here.');
  }

  const server = createServer((request, response) => {
    const origin = request.headers.origin;
    response.setHeader('Access-Control-Allow-Origin', config.origins ? (allowedOrigin(origin) ? (origin as string) : 'null') : '*');
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', request.headers['access-control-request-headers'] ?? 'Authorization, Content-Type');
    response.setHeader('Access-Control-Expose-Headers', '*');
    if (request.method === 'OPTIONS') return void response.writeHead(204).end();
    const url = new URL(request.url ?? '/', 'http://localhost');
    route(request, response, url).catch((error: unknown) => {
      if (response.headersSent) return void response.end();
      if (error instanceof HttpError) {
        if (error.status === 401 && url.pathname.startsWith('/git/')) response.setHeader('WWW-Authenticate', 'Basic realm="CADence"');
        return reply(response, error.status, { error: { code: error.code, message: error.message } });
      }
      reply(response, 500, { error: { code: 'failed', message: error instanceof Error ? error.message : String(error) } });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address() as AddressInfo;
  base ||= `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`;
  return {
    url: base,
    store,
    close: async () => {
      relay.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
