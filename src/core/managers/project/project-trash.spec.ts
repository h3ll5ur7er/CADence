import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { GitVersionAccess } from '@core/access/version';
import { GitHttpServer } from '@core/access/version/testing/git-http-server';
import type { CadDocument, ComponentDocument, DomainEvents, Result } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createParameterEngine } from '@core/engines/parameter';
import { MemoryFileSystem } from '@core/utilities/file-system';
import { EventBus } from '@core/utilities/messaging';
import { describe, expect, it } from 'vitest';
import { createProjectManager, type StoreChange } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const day = 24 * 60 * 60 * 1000;

/** A device whose clock moves a second per reading, and jumps when told. */
function device(name = 'a') {
  let seq = 0;
  let now = Date.parse('2026-10-20T10:00:00.000Z');
  const documents = new InMemoryDocumentAccess();
  const assets = new InMemoryAssetAccess();
  const files = new InMemoryExternalFileAccess();
  const events = new EventBus<DomainEvents>();
  const manager = createProjectManager({
    projects: new InMemoryProjectAccess(),
    documents,
    assets,
    externalFiles: files,
    parameters: createParameterEngine(),
    versions: new GitVersionAccess(new MemoryFileSystem()),
    versionDelay: 60_000,
    interchange: createInterchangeEngine(),
    events,
    clock: () => new Date((now += 1000)),
    newId: () => `${name}-${++seq}`,
  });
  return { manager, documents, assets, files, events, later: (days: number) => (now += days * day) };
}

/** Changes a component's parameters as an editor would (stored, then saved). */
async function edit(d: ReturnType<typeof device>, id: string, expression: string): Promise<void> {
  const component = (await d.documents.load(id as ComponentDocument['id'])) as ComponentDocument;
  await d.documents.store({ ...component, parameters: [{ id: 'p', name: 'width', expression }], modifiedAt: new Date().toISOString() });
  await d.manager.recordVersion(component.projectId);
}

describe('The trash (CAD-148)', () => {
  it('brings a deleted document back with its history', async () => {
    const d = device();
    const { project, firstDocument } = unwrap(await d.manager.createProject('Bracket'));
    await edit(d, firstDocument.id, '10 mm');
    await edit(d, firstDocument.id, '20 mm');
    const before = await d.manager.documentHistory(firstDocument.id);
    expect(before.length).toBeGreaterThanOrEqual(2);

    await d.manager.deleteDocument(firstDocument.id);
    expect(await d.manager.listDocuments(project.id)).toEqual([]);
    const [item] = await d.manager.listTrash();
    expect(item).toMatchObject({ kind: 'document', id: firstDocument.id, name: 'Component 1', projectName: 'Bracket', documentKind: 'component' });
    expect(Date.parse(item?.expiresAt as string) - Date.parse(item?.trashedAt as string)).toBe(30 * day);

    unwrap(await d.manager.restoreFromTrash(firstDocument.id));
    const restored = (await d.documents.load(firstDocument.id)) as ComponentDocument;
    expect(restored.parameters[0]?.expression).toBe('20 mm');
    // Its earlier versions are its history again, and the restore is a version of its own.
    const history = await d.manager.documentHistory(firstDocument.id);
    expect(history.map((v) => v.id)).toEqual(expect.arrayContaining(before.map((v) => v.id)));
    expect((await d.manager.projectHistory(project.id))[0]?.message).toBe('Restored Component 1 from the trash');
    expect(await d.manager.listTrash()).toEqual([]);
  });

  it('keeps an imported document’s original in the history, for when it comes back', async () => {
    const d = device();
    const { project } = unwrap(await d.manager.createProject('Clips'));
    const imported = unwrap(await d.manager.importFile(project.id, { name: 'clip.stl', bytes: new Uint8Array([1, 2, 3]) }));
    await d.manager.deleteDocument(imported.id);
    expect((await d.manager.previewImported(imported.id)).ok).toBe(false);
    unwrap(await d.manager.restoreFromTrash(imported.id));
    const document = (await d.documents.load(imported.id)) as Extract<CadDocument, { kind: 'imported' }>;
    expect([...((await d.assets.fetch(document.assetId))?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it('keeps a deleted project out of the lists until it is restored', async () => {
    const d = device();
    const { project, firstDocument } = unwrap(await d.manager.createProject('Shelf'));
    const changes: StoreChange[] = [];
    d.manager.watch((change) => changes.push(change));
    await d.manager.deleteProject(project.id);
    expect(await d.manager.listProjects()).toEqual([]);
    expect(await d.manager.findProject(project.id)).toBeUndefined();
    expect(await d.manager.listTrash()).toMatchObject([{ kind: 'project', id: project.id, name: 'Shelf', documentCount: 1 }]);
    unwrap(await d.manager.restoreFromTrash(project.id));
    expect((await d.manager.listProjects()).map((p) => p.name)).toEqual(['Shelf']);
    expect(await d.manager.findDocument(firstDocument.id)).toBeDefined();
    await d.events.drained();
    expect(changes).toEqual([
      { kind: 'projects', projectId: project.id },
      { kind: 'projects', projectId: project.id },
    ]);
  });

  it('deletes what has been in the trash for 30 days for good, and empties it by hand', async () => {
    const d = device();
    const old = unwrap(await d.manager.createProject('Old')).project;
    const recent = unwrap(await d.manager.createProject('Recent'));
    await d.manager.deleteProject(old.id);
    d.later(20);
    await d.manager.deleteDocument(recent.firstDocument.id);
    d.later(11);
    expect((await d.manager.listTrash()).map((i) => i.name)).toEqual(['Component 1']);
    expect(await d.manager.restoreFromTrash(old.id)).toMatchObject({ ok: false, error: { code: 'not-in-trash' } });
    await d.manager.emptyTrash();
    expect(await d.manager.listTrash()).toEqual([]);
    expect(await d.manager.restoreFromTrash(recent.firstDocument.id)).toMatchObject({ ok: false, error: { code: 'not-in-trash' } });
  });

  it('puts documents a synced version no longer has into the trash', async () => {
    const server = await GitHttpServer.start();
    try {
      const [a, b] = [device('a'), device('b')];
      const { project, firstDocument } = unwrap(await a.manager.createProject('Shared'));
      unwrap(await a.manager.setRemote(project.id, { url: `${server.repository('shared')}` }));
      unwrap(await a.manager.syncProject(project.id));
      const there = unwrap(await b.manager.openRemoteProject({ url: `${server.repository('shared')}` }));
      await a.manager.deleteDocument(firstDocument.id);
      unwrap(await a.manager.syncProject(project.id));
      unwrap(await b.manager.syncProject(there.id));
      expect(await b.manager.listDocuments(there.id)).toEqual([]);
      expect(await b.manager.listTrash()).toMatchObject([{ kind: 'document', id: firstDocument.id, projectId: there.id }]);
      unwrap(await b.manager.restoreFromTrash(firstDocument.id));
      expect((await b.manager.listDocuments(there.id)).map((x) => x.name)).toEqual(['Component 1']);
    } finally {
      await server.stop();
    }
  }, 30_000);
});

describe('Project notes and attachments (CAD-149)', () => {
  it('keeps a description, files and links, which survive an archive round trip', async () => {
    const [a, b] = [device('a'), device('b')];
    const { project } = unwrap(await a.manager.createProject('Robot arm'));
    unwrap(await a.manager.setProjectDescription(project.id, '# Robot arm\n\nServo **MG996R**, see the datasheet.'));
    const datasheet = unwrap(await a.manager.addAttachment(project.id, { file: { name: 'MG996R.pdf', bytes: new Uint8Array([37, 80, 68, 70]) } }));
    const link = unwrap(await a.manager.addAttachment(project.id, { link: { url: 'https://example.com/servo', name: 'Servo shop' } }));
    expect(datasheet).toMatchObject({ kind: 'file', name: 'MG996R.pdf', mediaType: 'application/pdf', byteLength: 4 });
    expect(link).toMatchObject({ kind: 'link', name: 'Servo shop', url: 'https://example.com/servo' });
    expect(await a.manager.addAttachment(project.id, { link: { url: 'javascript:alert(1)' } })).toMatchObject({ ok: false, error: { code: 'invalid-link' } });

    unwrap(await a.manager.exportProject(project.id, { history: true }));
    const archive = a.files.delivered.at(-1);
    const copy = unwrap(await b.manager.importProject({ name: 'Robot arm.cadence', bytes: archive?.bytes as Uint8Array }));
    expect(copy.description).toContain('Servo **MG996R**');
    expect(copy.attachments?.map((x) => x.name)).toEqual(['MG996R.pdf', 'Servo shop']);
    const file = unwrap(await b.manager.attachmentFile(copy.id, datasheet.id));
    expect([...file.bytes]).toEqual([37, 80, 68, 70]);
  });

  it('records notes and attachments in the versions, and gives a copy its own files', async () => {
    const d = device();
    const { project } = unwrap(await d.manager.createProject('Lamp'));
    const photo = unwrap(await d.manager.addAttachment(project.id, { file: { name: 'lamp.png', bytes: new Uint8Array([137, 80]) } }));
    unwrap(await d.manager.setProjectDescription(project.id, 'A desk lamp.'));
    await d.manager.recordVersion(project.id);
    expect((await d.manager.projectHistory(project.id)).length).toBeGreaterThan(0);

    const copy = unwrap(await d.manager.duplicateProject(project.id));
    const copied = copy.attachments?.[0];
    expect(copied?.kind === 'file' && photo.kind === 'file' && copied.assetId !== photo.assetId).toBe(true);
    unwrap(await d.manager.removeAttachment(project.id, photo.id));
    expect((await d.manager.findProject(project.id))?.attachments).toBeUndefined();
    // The copy keeps its own file.
    expect([...unwrap(await d.manager.attachmentFile(copy.id, copied?.id as string)).bytes]).toEqual([137, 80]);
  });
});
