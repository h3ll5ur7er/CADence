import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryProjectAccess } from '@core/access/project';
import { asDocumentId, asProjectId, type DomainEvents, type ImportedDocument, type Result } from '@core/contracts';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { beforeEach, describe, expect, it } from 'vitest';
import { createProjectManager, type ProjectManager } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

describe('ProjectManager', () => {
  let manager: ProjectManager;
  let documents: InMemoryDocumentAccess;
  let assets: InMemoryAssetAccess;
  let events: EventBus<DomainEvents>;
  let seq: number;

  beforeEach(() => {
    seq = 0;
    documents = new InMemoryDocumentAccess();
    assets = new InMemoryAssetAccess();
    events = new EventBus<DomainEvents>();
    manager = createProjectManager({
      projects: new InMemoryProjectAccess(),
      documents,
      assets,
      events,
      clock: steppingClock('2026-10-14T10:00:00.000Z'),
      newId: () => `id-${++seq}`,
    });
  });

  describe('projects', () => {
    it('lists nothing before the first project exists', async () => {
      expect(await manager.listProjects()).toEqual([]);
    });

    it('creates a project with a first component, ready to open', async () => {
      const { project, firstDocument } = unwrap(await manager.createProject('  Desk organizer '));
      expect(project.name).toBe('Desk organizer');
      expect(project.documentCount).toBe(1);
      expect(firstDocument).toMatchObject({ kind: 'component', name: 'Component 1', projectId: project.id });
      const stored = await documents.load(firstDocument.id);
      expect(stored).toMatchObject({ kind: 'component', units: 'mm', timeline: [], parameters: [] });
    });

    it.each(['', '   ', 'x'.repeat(81)])('rejects the invalid name %j', async (name) => {
      const result = await manager.createProject(name);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-name' } });
    });

    it('lists the most recently modified project first, with document counts', async () => {
      const a = unwrap(await manager.createProject('A')).project;
      unwrap(await manager.createProject('B'));
      unwrap(await manager.createDocument(a.id, 'assembly'));
      const list = await manager.listProjects();
      expect(list.map((p) => [p.name, p.documentCount])).toEqual([
        ['A', 2],
        ['B', 1],
      ]);
    });

    it('renames a project', async () => {
      const { project } = unwrap(await manager.createProject('Old'));
      unwrap(await manager.renameProject(project.id, 'New'));
      expect((await manager.findProject(project.id))?.name).toBe('New');
      expect(await manager.renameProject(asProjectId('nope'), 'X')).toMatchObject({
        ok: false,
        error: { code: 'unknown-project' },
      });
    });

    it('deletes a project with its documents and assets and announces it', async () => {
      const { project, firstDocument } = unwrap(await manager.createProject('Doomed'));
      const imported = unwrap(await manager.importFile(project.id, { name: 'part.stl', bytes: new Uint8Array(3) }));
      const assetId = ((await documents.load(imported.id)) as ImportedDocument).assetId;
      const announced: string[] = [];
      events.subscribe('projectDeleted', ({ projectId }) => {
        announced.push(projectId);
      });

      await manager.deleteProject(project.id);
      await events.drained();

      expect(await manager.listProjects()).toEqual([]);
      expect(await documents.load(firstDocument.id)).toBeUndefined();
      expect(await assets.fetch(assetId)).toBeUndefined();
      expect(announced).toEqual([project.id]);
    });
  });

  describe('documents', () => {
    it('numbers default names per kind', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const c2 = unwrap(await manager.createDocument(project.id, 'component'));
      const a1 = unwrap(await manager.createDocument(project.id, 'assembly'));
      const named = unwrap(await manager.createDocument(project.id, 'assembly', 'Gearbox'));
      expect([c2.name, a1.name, named.name]).toEqual(['Component 2', 'Assembly 1', 'Gearbox']);
    });

    it('lists documents grouped by kind and sorted by name', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      unwrap(await manager.createDocument(project.id, 'assembly', 'Zeta'));
      unwrap(await manager.createDocument(project.id, 'component', 'Bracket'));
      unwrap(await manager.createDocument(project.id, 'assembly', 'Alpha'));
      const names = (await manager.listDocuments(project.id)).map((d) => `${d.kind}:${d.name}`);
      expect(names).toEqual(['component:Bracket', 'component:Component 1', 'assembly:Alpha', 'assembly:Zeta']);
    });

    it('refuses documents in unknown projects', async () => {
      const result = await manager.createDocument(asProjectId('nope'), 'component');
      expect(result).toMatchObject({ ok: false, error: { code: 'unknown-project' } });
    });

    it('marks the project as modified when its documents change', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const before = (await manager.findProject(project.id))?.modifiedAt ?? '';
      unwrap(await manager.createDocument(project.id, 'component'));
      const after = (await manager.findProject(project.id))?.modifiedAt ?? '';
      expect(after > before).toBe(true);
    });

    it('renames a document and announces it', async () => {
      const { firstDocument } = unwrap(await manager.createProject('P'));
      const renamed: string[] = [];
      events.subscribe('documentRenamed', ({ name }) => {
        renamed.push(name);
      });
      unwrap(await manager.renameDocument(firstDocument.id, 'Hinge'));
      await events.drained();
      expect((await manager.findDocument(firstDocument.id))?.name).toBe('Hinge');
      expect(renamed).toEqual(['Hinge']);
      expect(await manager.renameDocument(asDocumentId('nope'), 'X')).toMatchObject({
        ok: false,
        error: { code: 'unknown-document' },
      });
    });

    it('deletes a document and announces it', async () => {
      const { project, firstDocument } = unwrap(await manager.createProject('P'));
      const deleted: string[] = [];
      events.subscribe('documentDeleted', ({ documentId }) => {
        deleted.push(documentId);
      });
      await manager.deleteDocument(firstDocument.id);
      await events.drained();
      expect(await manager.listDocuments(project.id)).toEqual([]);
      expect(deleted).toEqual([firstDocument.id]);
    });
  });

  describe('import', () => {
    it('keeps the original file and creates an imported document', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const doc = unwrap(await manager.importFile(project.id, { name: 'Bracket.STEP', bytes: new Uint8Array([1, 2]) }));
      expect(doc).toMatchObject({ kind: 'imported', name: 'Bracket' });
      const view = await manager.openImported(doc.id);
      expect(view).toMatchObject({ format: 'step', fileName: 'Bracket.STEP', byteLength: 2 });
    });

    it('rejects unsupported formats', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const result = await manager.importFile(project.id, { name: 'notes.txt', bytes: new Uint8Array(1) });
      expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-format' } });
    });

    it('releases the asset when the imported document is deleted', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const doc = unwrap(await manager.importFile(project.id, { name: 'a.svg', bytes: new Uint8Array(1) }));
      const assetId = ((await documents.load(doc.id)) as ImportedDocument).assetId;
      await manager.deleteDocument(doc.id);
      expect(await assets.fetch(assetId)).toBeUndefined();
    });
  });
});
