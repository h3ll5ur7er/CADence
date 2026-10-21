import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { GitVersionAccess } from '@core/access/version';
import type { DomainEvents, LiveEvent, Result } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createParameterEngine } from '@core/engines/parameter';
import { createProjectManager } from '@core/managers/project';
import { steppingClock } from '@core/utilities/clock';
import { MemoryFileSystem } from '@core/utilities/file-system';
import { EventBus } from '@core/utilities/messaging';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type RunningServer, startServer } from './server';
import { github } from './sign-in';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A device with its own storage, as another browser would have. */
function device(name: string) {
  let seq = 0;
  const documents = new InMemoryDocumentAccess();
  return {
    documents,
    manager: createProjectManager({
      projects: new InMemoryProjectAccess(),
      documents,
      assets: new InMemoryAssetAccess(),
      externalFiles: new InMemoryExternalFileAccess(),
      parameters: createParameterEngine(),
      versions: new GitVersionAccess(new MemoryFileSystem()),
      versionDelay: 60_000,
      interchange: createInterchangeEngine(),
      events: new EventBus<DomainEvents>(),
      clock: steppingClock('2026-10-21T10:00:00.000Z'),
      newId: () => `${name}-${++seq}`,
    }),
  };
}

/** The events of a live stream, as they arrive. */
async function listen(url: string, token: string): Promise<{ events: LiveEvent[]; next: (count: number) => Promise<LiveEvent[]>; close: () => void }> {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const events: LiveEvent[] = [];
  let buffer = '';
  let wake: (() => void) | undefined;
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += new TextDecoder().decode(value);
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (message.startsWith('data: ')) events.push(JSON.parse(message.slice(6)) as LiveEvent);
          wake?.();
        }
      }
    } catch {
      // Closed.
    }
  })();
  const next = async (count: number) => {
    while (events.length < count) await new Promise<void>((resolve) => (wake = resolve));
    return events.slice(0, count);
  };
  return { events, next, close: () => controller.abort() };
}

describe('CADence server (CAD-177, CAD-178)', { timeout: 60_000 }, () => {
  let server: RunningServer;
  let data: string;
  const api = async (path: string, token?: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await fetch(`${server.url}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const signIn = async (name: string) => (await api('/api/sign-in', undefined, { body: { name } })).body as { token: string; user: { id: string; name: string } };

  beforeAll(async () => {
    data = mkdtempSync(join(tmpdir(), 'cadence-server-'));
    server = await startServer({ data, providers: [], devSignIn: true });
  });
  afterAll(async () => {
    await server.close();
    rmSync(data, { recursive: true, force: true });
  });

  it('shares a project: the owner syncs it there, a member edits it, a link only views it', async () => {
    const ada = await signIn('Ada');
    const bob = await signIn('Bob');
    expect((await api('/api/me', ada.token)).body).toMatchObject({ name: 'Ada' });
    expect((await api('/api/me')).status).toBe(401);

    // Ada puts her project on the server and syncs it there with her sign-in.
    const created = (await api('/api/projects', ada.token, { body: { name: 'Bracket' } })).body as { id: string; git: string; role: string };
    expect(created).toMatchObject({ role: 'owner', git: `${server.url}/git/${created.id}.git` });
    const a = device('a');
    const { project } = unwrap(await a.manager.createProject('Bracket'));
    unwrap(await a.manager.setRemote(project.id, { url: created.git }));
    expect(await a.manager.syncProject(project.id)).toMatchObject({ ok: false, error: { code: 'remote-unauthorized' } });
    expect(unwrap(await a.manager.syncProject(project.id, { username: 'token', password: ada.token }))).toEqual({ kind: 'pushed' });

    // Bob is not a member yet: the project is not there for him.
    expect((await api(`/api/projects/${created.id}`, bob.token)).status).toBe(404);
    expect((await api(`/api/projects/${created.id}/members`, ada.token, { body: { user: 'bob', role: 'editor' } })).body['members']).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Bob', role: 'editor' })]),
    );
    expect(((await api('/api/projects', bob.token)).body as unknown as { name: string; role: string }[]).map((p) => `${p.name} ${p.role}`)).toEqual(['Bracket editor']);
    const b = device('b');
    const opened = unwrap(await b.manager.openRemoteProject({ url: created.git }, { username: 'token', password: bob.token }));
    unwrap(await b.manager.createDocument(opened.id, 'component', 'Lid'));
    expect(unwrap(await b.manager.syncProject(opened.id, { username: 'token', password: bob.token }))).toEqual({ kind: 'pushed' });
    // Only owners share.
    expect((await api(`/api/projects/${created.id}/links`, bob.token, { body: {} })).status).toBe(403);

    // A link to view: anyone with it opens the project, nobody with it changes it.
    const links = (await api(`/api/projects/${created.id}/links`, ada.token, { body: {} })).body['links'] as { token: string }[];
    const link = links[0]?.token as string;
    expect((await api(`/api/links/${link}`)).body).toMatchObject({ project: { id: created.id, name: 'Bracket' }, role: 'viewer', git: created.git });
    const c = device('c');
    const viewed = unwrap(await c.manager.openRemoteProject({ url: created.git }, { username: 'link', password: link }));
    expect((await c.manager.listDocuments(viewed.id)).map((d) => d.name)).toEqual(['Component 1', 'Lid']);
    unwrap(await c.manager.createDocument(viewed.id, 'component', 'Mine'));
    expect(await c.manager.syncProject(viewed.id, { username: 'link', password: link })).toMatchObject({ ok: false, error: { code: expect.stringMatching(/^remote-(rejected|unauthorized)$/) } });

    // Taken back: the link no longer opens it.
    await api(`/api/projects/${created.id}/links/${link}`, ada.token, { method: 'DELETE' });
    expect((await api(`/api/links/${link}`)).status).toBe(404);
    expect((await api(`/api/projects/${created.id}/members/${ada.user.id}`, ada.token, { method: 'DELETE' })).status).toBe(409);
  });

  it('relays commands to everyone in one order, with who is where, and catches up who was away', async () => {
    const ada = await signIn('Ada');
    const bob = await signIn('Bob');
    const { id } = (await api('/api/projects', ada.token, { body: { name: 'Live' } })).body as { id: string };
    await api(`/api/projects/${id}/members`, ada.token, { body: { user: bob.user.id, role: 'editor' } });
    const room = `${server.url}/live/${id}/d1`;
    const [one, two] = [await listen(`${room}?client=one&after=0`, ada.token), await listen(`${room}?client=two&after=0`, bob.token)];
    expect((await one.next(1))[0]).toMatchObject({ kind: 'welcome', seq: 0, entries: [] });
    await two.next(1);

    let ref = 0;
    const send = (token: string, clientId: string, command: unknown, again = false) => api(`/live/${id}/d1`, token, { body: { clientId, payload: { kind: 'command', ref: again ? ref : ++ref, command } } });
    expect((await send(ada.token, 'one', { type: 'a' })).body).toEqual({ seq: 1 });
    // Sent again (no answer came): taken once.
    expect((await send(ada.token, 'one', { type: 'a' }, true)).body).toEqual({ seq: 1 });
    expect((await send(bob.token, 'two', { type: 'b' })).body).toEqual({ seq: 2 });
    await api(`/live/${id}/d1/presence`, bob.token, { body: { clientId: 'two', where: { sketch: 's1' } } });
    const seen = (events: LiveEvent[]) => events.slice(1).map((e) => (e.kind === 'entry' ? `${e.entry.seq}:${e.entry.user.name}` : e.kind === 'presence' ? `${e.presence.user.name}@${e.presence.where.sketch}` : e.kind));
    // Bob is there as soon as he listens; then where he works.
    expect(seen(await one.next(5))).toEqual(['Bob@undefined', '1:Ada', '2:Bob', 'Bob@s1']);
    expect((await two.next(1))[0]).toMatchObject({ kind: 'welcome', present: [{ clientId: 'one' }, { clientId: 'two' }] });
    expect(seen(await two.next(4))).toEqual(['1:Ada', '2:Bob', 'Bob@s1']);

    // Bob leaves; Ada hears it. Back after seq 1, he gets what he missed, and who is there.
    two.close();
    expect((await one.next(6))[5]).toEqual({ kind: 'left', clientId: 'two' });
    await send(ada.token, 'one', { type: 'c' });
    const again = await listen(`${room}?client=two&after=1`, bob.token);
    const [welcome] = await again.next(1);
    expect(welcome).toMatchObject({ kind: 'welcome', seq: 3, entries: [{ seq: 2 }, { seq: 3 }] });

    // A snapshot replaces the entries before it; who comes back from before it starts from the snapshot.
    expect((await api(`/live/${id}/d1/snapshot`, ada.token, { body: { clientId: 'one', seq: 3, document: { name: 'at 3' } } })).body).toEqual({ kept: true });
    const late = await listen(`${room}?client=three&after=1`, ada.token);
    expect((await late.next(1))[0]).toMatchObject({ kind: 'welcome', reset: true, snapshot: { seq: 3, document: { name: 'at 3' } }, entries: [] });

    // A link may watch, not send.
    const links = (await api(`/api/projects/${id}/links`, ada.token, { body: {} })).body['links'] as { token: string }[];
    expect((await send(links[0]?.token as string, 'four', { type: 'd' })).status).toBe(403);
    for (const stream of [one, again, late]) stream.close();
  });

  it('signs in with GitHub: to GitHub, back with a code, and to the app with a token', async () => {
    // GitHub stands in: its sign-in page, token exchange and user API.
    const fake = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/login/oauth/access_token') return void response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'gh-token' }));
      if (url.pathname === '/user' && request.headers.authorization === 'Bearer gh-token') return void response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: 42, login: 'grace', name: 'Grace Hopper' }));
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
    const site = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    const folder = mkdtempSync(join(tmpdir(), 'cadence-server-'));
    const oauth = await startServer({ data: folder, providers: [github('id', 'secret', site, site)], origins: ['http://localhost:4200'] });
    try {
      expect((await fetch(`${oauth.url}/auth/github?return=https://evil.example/`, { redirect: 'manual' })).status).toBe(400);
      const start = await fetch(`${oauth.url}/auth/github?return=http://localhost:4200/projects`, { redirect: 'manual' });
      const to = new URL(start.headers.get('location') ?? '');
      expect(`${to.origin}${to.pathname}`).toBe(`${site}/login/oauth/authorize`);
      expect(to.searchParams.get('redirect_uri')).toBe(`${oauth.url}/auth/github/callback`);
      const back = await fetch(`${oauth.url}/auth/github/callback?code=c&state=${to.searchParams.get('state')}`, { redirect: 'manual' });
      const app = new URL(back.headers.get('location') ?? '');
      expect(`${app.origin}${app.pathname}`).toBe('http://localhost:4200/projects');
      const signedIn = new URLSearchParams(app.hash.slice(1));
      expect(signedIn.get('cadence-server')).toBe(oauth.url);
      const me = await fetch(`${oauth.url}/api/me`, { headers: { Authorization: `Bearer ${signedIn.get('cadence-token')}` } });
      expect(await me.json()).toMatchObject({ name: 'Grace Hopper' });
      // A state is used once.
      expect((await fetch(`${oauth.url}/auth/github/callback?code=c&state=${to.searchParams.get('state')}`, { redirect: 'manual' })).status).toBe(400);
    } finally {
      await oauth.close();
      await new Promise<void>((resolve) => fake.close(() => resolve()));
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
