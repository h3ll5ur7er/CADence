import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { GitVersionAccess } from '@core/access/version';
import type { AssemblyDocument, CadDocument, DomainEvents, ImportedDocument, ProjectTemplate, Result } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createParameterEngine } from '@core/engines/parameter';
import { steppingClock } from '@core/utilities/clock';
import { MemoryFileSystem } from '@core/utilities/file-system';
import { EventBus } from '@core/utilities/messaging';
import { describe, expect, it } from 'vitest';
import { createProjectManager } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A device with its own storage; ids are unique per device prefix. */
function device(name = 'a') {
  let seq = 0;
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
    clock: steppingClock('2026-10-16T10:00:00.000Z'),
    newId: () => `${name}-${++seq}`,
  });
  return { manager, documents, assets, files, events };
}

/** A project with a component, an imported file the component inserts, and an assembly of the component. */
async function sample(d: ReturnType<typeof device>) {
  const { project, firstDocument } = unwrap(await d.manager.createProject('Bracket'));
  unwrap(await d.manager.setProjectParameters(project.id, [{ id: 'w', name: 'wall', expression: '3 mm' }]));
  const imported = unwrap(await d.manager.importFile(project.id, { name: 'clip.stl', bytes: new Uint8Array([1, 2, 3]) }));
  const component = (await d.documents.load(firstDocument.id)) as CadDocument;
  await d.documents.store({ ...component, timeline: [{ type: 'insert', id: 'f1', name: 'Clip', suppressed: false, document: imported.id }] } as CadDocument);
  const assembly = unwrap(await d.manager.createDocument(project.id, 'assembly', 'Frame'));
  const stored = (await d.documents.load(assembly.id)) as AssemblyDocument;
  await d.documents.store({ ...stored, instances: [{ id: 'i1', name: 'Bracket 1', component: firstDocument.id, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], grounded: true }] } as unknown as CadDocument);
  return { project, component: firstDocument, imported, assembly };
}

const instanceOf = (document: CadDocument | undefined) => (document as AssemblyDocument).instances[0]?.component;
const insertOf = (document: CadDocument | undefined) => ((document as unknown as { timeline: { document: string }[] }).timeline[0] as { document: string }).document;

describe('ProjectManager copies, archives and templates', () => {
  it('duplicates a project with new ids, its references following', async () => {
    const d = device();
    const { project } = await sample(d);
    const copy = unwrap(await d.manager.duplicateProject(project.id));
    expect(copy).toMatchObject({ name: 'Bracket (copy)', documentCount: 3, parameters: [{ name: 'wall', expression: '3 mm' }] });
    const documents = await Promise.all((await d.manager.listDocuments(copy.id)).map((s) => d.documents.load(s.id)));
    const [component, assembly, imported] = documents as [CadDocument, CadDocument, ImportedDocument];
    expect([component.kind, assembly.kind, imported.kind]).toEqual(['component', 'assembly', 'imported']);
    expect(instanceOf(assembly)).toBe(component.id);
    expect(insertOf(component)).toBe(imported.id);
    expect([...((await d.assets.fetch(imported.assetId))?.bytes ?? [])]).toEqual([1, 2, 3]);
    // The original is untouched, and the copy has a history of its own.
    expect((await d.manager.listDocuments(project.id)).length).toBe(3);
    expect((await d.manager.projectHistory(copy.id)).map((v) => v.message)).toEqual(['Duplicated from Bracket']);
  });

  it('duplicates a document in its project, its original too', async () => {
    const d = device();
    const { project, imported } = await sample(d);
    const copy = unwrap(await d.manager.duplicateDocument(imported.id));
    expect(copy).toMatchObject({ name: 'clip (copy)', kind: 'imported', projectId: project.id });
    const stored = (await d.documents.load(copy.id)) as ImportedDocument;
    expect(stored.assetId).not.toBe(((await d.documents.load(imported.id)) as ImportedDocument).assetId);
    // Deleting the copy keeps the original's file.
    await d.manager.deleteDocument(copy.id);
    const original = (await d.documents.load(imported.id)) as ImportedDocument;
    expect([...((await d.assets.fetch(original.assetId))?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it('replaces an imported file; what uses it is told to regenerate', async () => {
    const d = device();
    const { component, imported, assembly } = await sample(d);
    const restored: string[] = [];
    d.events.subscribe('documentRestored', ({ documentId }) => void restored.push(documentId));
    const before = ((await d.documents.load(imported.id)) as ImportedDocument).assetId;
    unwrap(await d.manager.replaceImported(imported.id, { name: 'clip-v2.obj', bytes: new Uint8Array([4, 5]) }));
    await d.events.drained();
    const after = (await d.documents.load(imported.id)) as ImportedDocument;
    expect(after).toMatchObject({ format: 'obj', fileName: 'clip-v2.obj', byteLength: 2 });
    expect(await d.assets.fetch(before)).toBeUndefined();
    expect(restored.sort()).toEqual([component.id, imported.id].sort());
    expect(restored).not.toContain(assembly.id);
    expect(await d.manager.replaceImported(imported.id, { name: 'logo.svg', bytes: new Uint8Array([1]) })).toMatchObject({ ok: false, error: { code: 'unsupported-format' } });
  });

  it('exports a project as an archive and imports it again, on this device and on another', async () => {
    const a = device('a');
    const { project } = await sample(a);
    await a.manager.recordVersion(project.id, 'First');
    unwrap(await a.manager.exportProject(project.id, { history: true }));
    const archive = a.files.delivered[0];
    expect(archive?.name).toBe('Bracket.cadence');

    // Another device keeps the ids and the history.
    const b = device('b');
    const there = unwrap(await b.manager.importProject({ name: 'Bracket.cadence', bytes: archive?.bytes as Uint8Array }));
    expect(there).toMatchObject({ name: 'Bracket', documentCount: 3 });
    expect((await b.manager.listDocuments(there.id)).map((x) => x.id).sort()).toEqual((await a.manager.listDocuments(project.id)).map((x) => x.id).sort());
    expect((await b.manager.projectHistory(there.id)).map((v) => v.message)).toContain('First');

    // This device has the documents already: new ids, a new history.
    const here = unwrap(await a.manager.importProject({ name: 'Bracket.cadence', bytes: archive?.bytes as Uint8Array }));
    const ids = (await a.manager.listDocuments(here.id)).map((x) => x.id);
    expect(ids.some((id) => id.startsWith('a-'))).toBe(true);
    expect(ids).not.toContain((await a.manager.listDocuments(project.id))[0]?.id);
    expect((await a.manager.projectHistory(here.id)).map((v) => v.message)).toEqual(['Imported from Bracket.cadence']);

    expect(await a.manager.importProject({ name: 'clip.stl', bytes: new Uint8Array([1, 2, 3]) })).toMatchObject({ ok: false, error: { code: 'not-an-archive' } });
  });

  it('creates projects from templates, each with new ids', async () => {
    const d = device();
    const template: ProjectTemplate = {
      id: 'plate',
      name: 'Plate',
      description: 'A plate',
      parameters: [{ id: 'p', name: 'thickness', expression: '4 mm' }],
      documents: [
        { id: 't-1', projectId: 'template', kind: 'component', name: 'Plate', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z', schemaVersion: 2, units: 'mm', parameters: [], timeline: [], rollbackIndex: 0 } as unknown as CadDocument,
      ],
    };
    const first = unwrap(await d.manager.createFromTemplate(template));
    const second = unwrap(await d.manager.createFromTemplate(template));
    expect(first.project).toMatchObject({ name: 'Plate', parameters: [{ name: 'thickness' }] });
    expect(first.firstDocument).toMatchObject({ name: 'Plate', kind: 'component', projectId: first.project.id });
    expect(first.firstDocument.id).not.toBe(second.firstDocument.id);
    expect(first.firstDocument.id).not.toBe('t-1');
  });
});
