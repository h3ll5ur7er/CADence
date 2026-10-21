import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { HttpServerAccess } from '@core/access/server';
import { createShapeAccess } from '@core/access/shape';
import { asDocumentId, asProjectId, type ComponentDocument, currentSchemaVersion, type DomainEvents, type Result, type SketchEntity } from '@core/contracts';
import { createAnalysisEngine } from '@core/engines/analysis';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type RunningServer, startServer } from '../../../../server/server';
import { createDesignManager, type DesignSession } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const shapes = createShapeAccess();
const engines = { sketches: createSketchEngine(), parameters: createParameterEngine(), modeling: createModelingEngine(shapes), interchange: createInterchangeEngine(shapes), analysis: createAnalysisEngine(shapes) };
const documentId = asDocumentId('d1');

/** A fetch that can go offline: requests fail, and open streams break, until it is back. */
function flakyFetch() {
  let offline = false;
  const open = new Set<AbortController>();
  const fetcher: typeof fetch = async (input, init) => {
    if (offline) throw new TypeError('offline');
    const controller = new AbortController();
    init?.signal?.addEventListener('abort', () => controller.abort());
    open.add(controller);
    return fetch(input, { ...init, signal: controller.signal });
  };
  return {
    fetcher,
    set offline(value: boolean) {
      offline = value;
      if (value) for (const controller of open) controller.abort();
      open.clear();
    },
  };
}

/** A browser of its own: its storage and its session on the component, live through the server. */
async function browser(name: string) {
  const documents = new InMemoryDocumentAccess();
  const projects = new InMemoryProjectAccess();
  await projects.establish({ id: asProjectId('p1'), name: 'Live', createdAt: '2026-10-21T10:00:00.000Z', modifiedAt: '2026-10-21T10:00:00.000Z' });
  const document: ComponentDocument = {
    id: documentId,
    projectId: asProjectId('p1'),
    kind: 'component',
    name: 'Component 1',
    createdAt: '2026-10-21T10:00:00.000Z',
    modifiedAt: '2026-10-21T10:00:00.000Z',
    schemaVersion: currentSchemaVersion,
    units: 'mm',
    parameters: [],
    timeline: [],
    rollbackIndex: 0,
  };
  await documents.store(document);
  const network = flakyFetch();
  const manager = createDesignManager({
    projects,
    documents,
    externalFiles: new InMemoryExternalFileAccess(),
    ...engines,
    assets: new InMemoryAssetAccess(),
    events: new EventBus<DomainEvents>(),
    clock: steppingClock('2026-10-21T11:00:00.000Z'),
    server: new HttpServerAccess(network.fetcher),
  });
  const session = unwrap(await manager.open(documentId));
  session.subscribe(() => undefined);
  return { name, session, network };
}

const point = (id: string, x: number, y: number): SketchEntity => ({ id, kind: 'point', x, y });
const line = (id: string, start: string, end: string): SketchEntity => ({ id, kind: 'line', start, end, construction: false });
const ids = (session: DesignSession) => session.state().sketches.get('s1')?.sketch.entities.map((e) => e.id).sort() ?? [];
const waitFor = (check: () => void) => vi.waitFor(check, { timeout: 15_000, interval: 50 });

describe('editing live (CAD-178)', { timeout: 60_000 }, () => {
  let server: RunningServer;
  let data: string;
  let target: (token: string) => { server: string; project: string; token: string };
  let tokens: { ada: string; bob: string };

  beforeAll(async () => {
    data = mkdtempSync(join(tmpdir(), 'cadence-live-'));
    server = await startServer({ data, providers: [], devSignIn: true });
    const access = new HttpServerAccess();
    const [ada, bob] = [await access.signInByName(server.url, 'Ada'), await access.signInByName(server.url, 'Bob')];
    const project = await access.createProject(ada, 'Live');
    await access.setMember(ada, project.id, 'Bob', 'editor');
    tokens = { ada: ada.token, bob: bob.token };
    target = (token) => ({ server: server.url, project: project.id, token });
  });
  afterAll(async () => {
    await server.close();
    rmSync(data, { recursive: true, force: true });
  });

  it('two people draw in one sketch at once, see who is where, and one catches up after being offline', async () => {
    const [ada, bob] = [await browser('Ada'), await browser('Bob')];
    unwrap(ada.session.goLive(target(tokens.ada)));
    await waitFor(() => expect(ada.session.state().live?.status).toBe('live'));
    unwrap(bob.session.goLive(target(tokens.bob)));
    await waitFor(() => expect(bob.session.state().live?.status).toBe('live'));

    unwrap(await ada.session.execute({ type: 'create-sketch', id: 's1', plane: 'XY' }));
    await waitFor(() => expect(bob.session.state().sketches.has('s1')).toBe(true));

    // At the same time: a line from each, neither waiting for the other.
    const both = await Promise.all([
      ada.session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [point('a1', 0, 0), point('a2', 40, 0), line('a', 'a1', 'a2')], constraints: [] }),
      bob.session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [point('b1', 0, 20), point('b2', 40, 20), line('b', 'b1', 'b2')], constraints: [] }),
    ]);
    both.forEach(unwrap);
    const all = ['a', 'a1', 'a2', 'b', 'b1', 'b2'];
    await waitFor(() => expect([ids(ada.session), ids(bob.session)]).toEqual([all, all]));

    // Who is where.
    ada.session.present({ sketch: 's1', point: [10, 5] });
    await waitFor(() => expect(bob.session.state().live?.others).toEqual([expect.objectContaining({ user: expect.objectContaining({ name: 'Ada' }), where: { sketch: 's1', point: [10, 5] } })]));

    // Bob goes offline and keeps drawing; Ada draws too. Back online, both have everything.
    bob.network.offline = true;
    await waitFor(() => expect(bob.session.state().live?.status).not.toBe('live'));
    unwrap(await bob.session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [point('c1', 0, 40)], constraints: [] }));
    unwrap(await ada.session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [point('d1', 50, 40)], constraints: [] }));
    expect(ids(bob.session)).toContain('c1');
    bob.network.offline = false;
    const everything = [...all, 'c1', 'd1'].sort();
    await waitFor(() => expect([ids(ada.session), ids(bob.session)]).toEqual([everything, everything]));
    // Stored as it is shown, in both.
    expect(bob.session.state().document.timeline).toEqual(ada.session.state().document.timeline.map((item) => expect.objectContaining({ id: item.id })));

    // A change that no longer applies after another's goes for everyone: Bob deletes the sketch while Ada adds to it.
    await Promise.all([
      ada.session.execute({ type: 'add-sketch-geometry', sketchId: 's1', entities: [point('e1', 60, 0)], constraints: [] }),
      bob.session.execute({ type: 'delete-item', itemId: 's1' }),
    ]);
    await waitFor(() => expect([ada.session.state().document.timeline.length, bob.session.state().document.timeline.length]).toEqual([0, 0]));

    ada.session.leaveLive();
    await waitFor(() => expect(bob.session.state().live?.others).toEqual([]));
    bob.session.leaveLive();
  });

  it('a late joiner starts from the room, and someone with a view link only watches', async () => {
    const [ada, carl] = [await browser('Ada'), await browser('Carl')];
    unwrap(ada.session.goLive(target(tokens.ada)));
    await waitFor(() => expect(ada.session.state().live?.status).toBe('live'));
    unwrap(await ada.session.execute({ type: 'add-parameter', parameter: { id: 'w', name: 'width', expression: '40 mm' } }));
    const access = new HttpServerAccess();
    const project = target(tokens.ada).project;
    const linked = await access.addLink({ server: server.url, token: tokens.ada }, project);
    const link = linked.links?.[0]?.token as string;
    unwrap(carl.session.goLive({ ...target(link), viewOnly: true }));
    await waitFor(() => expect(carl.session.state().document.parameters.map((p) => p.name)).toContain('width'));
    expect(carl.session.state().live?.viewOnly).toBe(true);
    unwrap(await carl.session.execute({ type: 'add-parameter', parameter: { id: 'h', name: 'height', expression: '5 mm' } }));
    unwrap(await ada.session.execute({ type: 'set-parameter', parameter: { id: 'w', name: 'width', expression: '50 mm' } }));
    await waitFor(() => expect(carl.session.state().document.parameters.find((p) => p.name === 'width')?.expression).toBe('50 mm'));
    expect(ada.session.state().document.parameters.map((p) => p.name)).not.toContain('height');
    ada.session.leaveLive();
    carl.session.leaveLive();
  });
});
