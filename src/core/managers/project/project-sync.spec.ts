import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { GitVersionAccess } from '@core/access/version';
import { GitHttpServer } from '@core/access/version/testing/git-http-server';
import type { DomainEvents, ImportedDocument, ProjectId, Result } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createParameterEngine } from '@core/engines/parameter';
import { steppingClock } from '@core/utilities/clock';
import { MemoryFileSystem } from '@core/utilities/file-system';
import { EventBus } from '@core/utilities/messaging';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProjectManager } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A device: its own storage and version histories, as another browser or computer would have. */
function device(name: string) {
  let seq = 0;
  const documents = new InMemoryDocumentAccess();
  const assets = new InMemoryAssetAccess();
  const manager = createProjectManager({
    projects: new InMemoryProjectAccess(),
    documents,
    assets,
    externalFiles: new InMemoryExternalFileAccess(),
    parameters: createParameterEngine(),
    versions: new GitVersionAccess(new MemoryFileSystem()),
    // Versions are recorded when syncing; none on their own while the test runs.
    versionDelay: 60_000,
    interchange: createInterchangeEngine(),
    events: new EventBus<DomainEvents>(),
    clock: steppingClock('2026-10-15T10:00:00.000Z'),
    newId: () => `${name}-${++seq}`,
  });
  const names = async (projectId: ProjectId) => (await manager.listDocuments(projectId)).map((d) => d.name);
  return { manager, documents, assets, names };
}

// Each exchange runs a git process per request: slower than the other tests.
describe('ProjectManager sync (git over HTTP)', { timeout: 30_000 }, () => {
  let server: GitHttpServer;
  beforeAll(async () => {
    server = await GitHttpServer.start();
  });
  afterAll(() => server.stop());

  /** A project on device A, shared with a new remote and opened on device B. */
  async function shared(repository: string) {
    const [a, b] = [device('a'), device('b')];
    const remote = { url: server.repository(repository) };
    const { project, firstDocument } = unwrap(await a.manager.createProject('Bracket'));
    unwrap(await a.manager.setProjectParameters(project.id, [{ id: 'w', name: 'wall', expression: '3 mm' }]));
    unwrap(await a.manager.setRemote(project.id, remote));
    expect(unwrap(await a.manager.syncProject(project.id))).toEqual({ kind: 'pushed' });
    const opened = unwrap(await b.manager.openRemoteProject(remote));
    return { a, b, remote, projectA: project.id, projectB: opened.id, first: firstDocument, opened };
  }

  it('shares a project: pushed from one device, opened and changed on another, pulled back', async () => {
    const { a, b, projectA, projectB, first, opened } = await shared('bracket');
    expect(opened).toMatchObject({ name: 'Bracket', parameters: [{ id: 'w', name: 'wall', expression: '3 mm' }], remote: { url: expect.stringContaining('bracket.git') } });
    expect(await b.names(projectB)).toEqual(['Component 1']);
    expect((await b.documents.load(first.id))?.projectId).toBe(projectB);

    unwrap(await b.manager.renameDocument(first.id, 'Base plate'));
    expect(unwrap(await b.manager.syncProject(projectB))).toEqual({ kind: 'pushed' });
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'pulled' });
    expect(await a.names(projectA)).toEqual(['Base plate']);
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'up-to-date' });
  });

  it('merges changes to different documents, and asks about documents changed on both sides', async () => {
    const { a, b, projectA, projectB, first } = await shared('merging');
    unwrap(await a.manager.createDocument(projectA, 'assembly', 'Frame'));
    unwrap(await b.manager.createDocument(projectB, 'component', 'Lid'));
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'pushed' });
    expect(unwrap(await b.manager.syncProject(projectB))).toEqual({ kind: 'merged' });
    expect(await b.names(projectB)).toEqual(['Component 1', 'Lid', 'Frame']);
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'pulled' });
    expect(await a.names(projectA)).toEqual(['Component 1', 'Lid', 'Frame']);

    unwrap(await a.manager.renameDocument(first.id, 'Mine'));
    unwrap(await b.manager.renameDocument(first.id, 'Theirs'));
    unwrap(await b.manager.syncProject(projectB));
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'conflicts', conflicts: [{ path: `documents/${first.id}.json`, name: 'Mine' }] });
    expect(await a.names(projectA)).toContain('Mine');
    expect(unwrap(await a.manager.syncProject(projectA, undefined, { [`documents/${first.id}.json`]: 'theirs' }))).toEqual({ kind: 'merged' });
    expect(await a.names(projectA)).toContain('Theirs');
    expect(server.log('merging')[0]).toMatch(/^Merged the changes from/);
  });

  it('carries imported originals along, and removes documents removed on the other side', async () => {
    const { a, b, projectA, projectB } = await shared('originals');
    const imported = unwrap(await a.manager.importFile(projectA, { name: 'clip.stl', bytes: new Uint8Array([1, 2, 3]) }));
    unwrap(await a.manager.syncProject(projectA));
    expect(unwrap(await b.manager.syncProject(projectB))).toEqual({ kind: 'pulled' });
    const document = (await b.documents.load(imported.id)) as ImportedDocument;
    expect([...((await b.assets.fetch(document.assetId))?.bytes ?? [])]).toEqual([1, 2, 3]);

    await b.manager.deleteDocument(imported.id);
    unwrap(await b.manager.syncProject(projectB));
    unwrap(await a.manager.syncProject(projectA));
    expect(await a.names(projectA)).toEqual(['Component 1']);
  });

  it('syncs version names, and tells which versions the remote has', async () => {
    const { a, b, projectA, projectB } = await shared('names');
    unwrap(await a.manager.nameVersion(projectA, 'v1.0'));
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'up-to-date' });
    expect(unwrap(await b.manager.syncProject(projectB))).toEqual({ kind: 'up-to-date' });
    expect((await b.manager.projectHistory(projectB)).flatMap((v) => v.names)).toEqual(['v1.0']);

    // A version made here is not on the remote until the next sync.
    unwrap(await b.manager.createDocument(projectB, 'component', 'Lid'));
    await b.manager.recordVersion(projectB);
    expect((await b.manager.projectHistory(projectB)).map((v) => v.shared)).toEqual([false, true]);
    unwrap(await b.manager.syncProject(projectB));
    expect((await b.manager.projectHistory(projectB)).map((v) => v.shared)).toEqual([true, true]);

    // The same name for different versions stays as it is on each side.
    unwrap(await a.manager.syncProject(projectA));
    const [newest, older] = await a.manager.projectHistory(projectA);
    unwrap(await a.manager.nameVersion(projectA, 'final', older?.id));
    unwrap(await b.manager.nameVersion(projectB, 'final', newest?.id));
    unwrap(await b.manager.syncProject(projectB));
    expect(unwrap(await a.manager.syncProject(projectA))).toEqual({ kind: 'up-to-date', nameConflicts: ['final'] });
    expect((await a.manager.projectHistory(projectA)).find((v) => v.names.includes('final'))?.id).toBe(older?.id);
  });

  it('explains what keeps a sync from working', async () => {
    const { manager } = device('c');
    const { project } = unwrap(await manager.createProject('Alone'));
    expect(await manager.syncProject(project.id)).toMatchObject({ ok: false, error: { code: 'no-remote' } });
    expect(await manager.setRemote(project.id, { url: 'git@github.com:me/alone.git' })).toMatchObject({ ok: false, error: { code: 'invalid-remote' } });
    unwrap(await manager.setRemote(project.id, { url: 'http://127.0.0.1:9/alone.git' }));
    expect(await manager.syncProject(project.id)).toMatchObject({ ok: false, error: { code: 'remote-unreachable' } });
    expect(await manager.openRemoteProject({ url: 'http://127.0.0.1:9/alone.git' })).toMatchObject({ ok: false, error: { code: 'remote-unreachable' } });
    expect((await manager.listProjects()).map((p) => p.name)).toEqual(['Alone']);
  });
});
