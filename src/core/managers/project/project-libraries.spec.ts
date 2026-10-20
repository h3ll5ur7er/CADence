import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { GitVersionAccess } from '@core/access/version';
import { type CadDocument, type ComponentDocument, type DomainEvents, type Result, standardLibraryId } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createParameterEngine } from '@core/engines/parameter';
import { steppingClock } from '@core/utilities/clock';
import { MemoryFileSystem } from '@core/utilities/file-system';
import { EventBus } from '@core/utilities/messaging';
import { describe, expect, it } from 'vitest';
import { createProjectManager } from './index';
import { findStandardPart, standardParts } from './standard-library';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

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
    clock: steppingClock('2026-10-20T10:00:00.000Z'),
    newId: () => `${name}-${++seq}`,
  });
  return { manager, documents, assets, files, events };
}

/** A library project with a bracket that inserts an imported file and uses a project parameter. */
async function library(d: ReturnType<typeof device>) {
  const { project, firstDocument } = unwrap(await d.manager.createProject('Company brackets'));
  unwrap(await d.manager.setLibrary(project.id, true));
  unwrap(await d.manager.setProjectParameters(project.id, [{ id: 'w', name: 'wall', expression: '3 mm' }]));
  unwrap(await d.manager.renameDocument(firstDocument.id, 'Bracket'));
  const clip = unwrap(await d.manager.importFile(project.id, { name: 'clip.stl', bytes: new Uint8Array([1, 2, 3]) }));
  await change(d, firstDocument.id, { timeline: [{ type: 'insert', id: 'f1', name: 'Clip', suppressed: false, document: clip.id }], parameters: [{ id: 'd', name: 'depth', expression: 'wall * 2' }] });
  const id = (await d.manager.findProject(project.id))?.library?.id as string;
  return { project, bracket: firstDocument.id, clip: clip.id, id };
}

async function change(d: ReturnType<typeof device>, id: string, fields: Partial<ComponentDocument>): Promise<void> {
  const document = (await d.documents.load(id as CadDocument['id'])) as ComponentDocument;
  await d.documents.store({ ...document, ...fields, modifiedAt: new Date(Date.parse(document.modifiedAt) + 1000).toISOString() });
}

describe('Libraries shared between projects (CAD-151)', () => {
  it('lists libraries and their parts, the standard parts first', async () => {
    const d = device();
    const lib = await library(d);
    unwrap(await d.manager.createProject('Robot'));
    const libraries = await d.manager.listLibraries();
    expect(libraries.map((l) => [l.id, l.name, l.partCount])).toEqual([
      [standardLibraryId, 'Standard parts', standardParts.length],
      [lib.id, 'Company brackets', 1],
    ]);
    expect(unwrap(await d.manager.libraryParts(lib.id))).toEqual([{ id: lib.bracket, name: 'Bracket' }]);
  });

  it('keeps a library part as the library version it took, and updates it when asked', async () => {
    const d = device();
    const lib = await library(d);
    const robot = unwrap(await d.manager.createProject('Robot')).project;
    const part = unwrap(await d.manager.useLibraryPart(robot.id, lib.id, 'Bracket'));
    expect(part).toMatchObject({ kind: 'component', name: 'Bracket', projectId: robot.id, library: { library: lib.id, libraryName: 'Company brackets', document: lib.bracket, follow: 'asked' } });
    const copy = (await d.documents.load(part.id)) as ComponentDocument;
    // The library's parameters come along as its own, and the file it inserts with it.
    expect(copy.parameters.map((p) => `${p.name} = ${p.expression}`)).toEqual(['wall = 3 mm', 'depth = wall * 2']);
    const inserted = copy.timeline[0]?.type === 'insert' ? copy.timeline[0].document : undefined;
    expect(inserted).not.toBe(lib.clip);
    expect(await d.manager.findDocument(inserted as CadDocument['id'])).toMatchObject({ kind: 'imported', projectId: robot.id, library: { document: lib.clip } });
    // Taken again, it is the same document.
    expect(unwrap(await d.manager.useLibraryPart(robot.id, lib.id, lib.bracket)).id).toBe(part.id);

    await change(d, lib.bracket, { parameters: [{ id: 'd', name: 'depth', expression: 'wall * 3' }] });
    const [update] = await d.manager.libraryUpdates(robot.id);
    expect(update).toMatchObject({ document: { id: part.id }, link: { version: part.library?.version } });
    expect(update?.latest).not.toBe(part.library?.version);
    expect(((await d.documents.load(part.id)) as ComponentDocument).parameters[1]?.expression).toBe('wall * 2');

    const restored: string[] = [];
    d.events.subscribe('documentRestored', ({ documentId }) => void restored.push(documentId));
    const [updated] = unwrap(await d.manager.updateLibraryParts(robot.id));
    expect(updated?.id).toBe(part.id);
    expect(updated?.library?.version).toBe(update?.latest);
    expect(((await d.documents.load(part.id)) as ComponentDocument).parameters[1]?.expression).toBe('wall * 3');
    expect(restored).toContain(part.id);
    expect(await d.manager.libraryUpdates(robot.id)).toEqual([]);
  });

  it('follows the library on its own when the part is to follow it always', async () => {
    const d = device();
    const lib = await library(d);
    const robot = unwrap(await d.manager.createProject('Robot')).project;
    const part = unwrap(await d.manager.useLibraryPart(robot.id, lib.id, 'Bracket', { follow: 'always' }));
    await change(d, lib.bracket, { parameters: [{ id: 'd', name: 'depth', expression: '9 mm' }] });
    await d.manager.recordVersion(lib.project.id);
    expect(((await d.documents.load(part.id)) as ComponentDocument).parameters.at(-1)?.expression).toBe('9 mm');
  });

  it('refuses parts of the project itself and libraries that are not here', async () => {
    const d = device();
    const lib = await library(d);
    expect(await d.manager.useLibraryPart(lib.project.id, lib.id, 'Bracket')).toMatchObject({ ok: false, error: { code: 'same-project' } });
    expect(await d.manager.useLibraryPart(lib.project.id, 'nowhere', 'Bracket')).toMatchObject({ ok: false, error: { code: 'unknown-library' } });
  });

  it('carries the parts in archives, and the libraries too when asked', async () => {
    const [a, b] = [device('a'), device('b')];
    const lib = await library(a);
    const robot = unwrap(await a.manager.createProject('Robot')).project;
    const part = unwrap(await a.manager.useLibraryPart(robot.id, lib.id, 'Bracket'));
    unwrap(await a.manager.exportProject(robot.id, { libraries: true }));
    const opened = unwrap(await b.manager.importProject({ name: 'Robot.cadence', bytes: a.files.delivered.at(-1)?.bytes as Uint8Array }));
    expect((await b.manager.listDocuments(opened.id)).find((x) => x.id === part.id)?.library?.library).toBe(lib.id);
    // The library came along as a project of its own, and updates find it there.
    const libraries = await b.manager.listLibraries();
    expect(libraries.map((l) => l.id)).toEqual([standardLibraryId, lib.id]);
    expect(await b.manager.libraryUpdates(opened.id)).toEqual([]);
  });
});

describe('The standard library (CAD-152)', () => {
  it('has every catalogue part in every size, named by designation', () => {
    expect(standardParts.filter((p) => p.spec.kind === 'nut')).toHaveLength(8);
    expect(findStandardPart('ISO 4762 M3 x 12')?.key).toBe('screw-M3-12');
    expect(findStandardPart('screw-M8-100')?.designation).toBe('ISO 4762 M8 × 100');
    expect(findStandardPart('ISO 4762 M3 × 13')).toBeUndefined();
    expect(new Set(standardParts.map((p) => p.key)).size).toBe(standardParts.length);
  });

  it('makes a standard part a steel component of the project, once', async () => {
    const d = device();
    const { project } = unwrap(await d.manager.createProject('Robot'));
    const screw = unwrap(await d.manager.useLibraryPart(project.id, standardLibraryId, 'ISO 4762 M3 × 12'));
    const document = (await d.documents.load(screw.id)) as ComponentDocument;
    expect(document).toMatchObject({ name: 'ISO 4762 M3 × 12', material: { name: 'Steel' }, library: { library: standardLibraryId, document: 'screw-M3-12' } });
    expect(document.timeline[1]).toMatchObject({ type: 'part', part: { kind: 'screw', size: 'M3', length: '12 mm' }, points: ['origin'] });
    expect(unwrap(await d.manager.useLibraryPart(project.id, standardLibraryId, 'screw-M3-12')).id).toBe(screw.id);
    expect(await d.manager.useLibraryPart(project.id, standardLibraryId, 'M3 screw')).toMatchObject({ ok: false, error: { code: 'unknown-part' } });
  });
});
