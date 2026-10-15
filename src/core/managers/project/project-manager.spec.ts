import { InMemoryAssetAccess } from '@core/access/asset';
import { InMemoryDocumentAccess } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import { InMemoryProjectAccess } from '@core/access/project';
import { asDocumentId, asProjectId, type DomainEvents, type ImportedDocument, type Result } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { steppingClock } from '@core/utilities/clock';
import { EventBus } from '@core/utilities/messaging';
import { createParameterEngine } from '@core/engines/parameter';
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
  let files: InMemoryExternalFileAccess;
  let events: EventBus<DomainEvents>;
  let seq: number;

  beforeEach(() => {
    seq = 0;
    documents = new InMemoryDocumentAccess();
    assets = new InMemoryAssetAccess();
    files = new InMemoryExternalFileAccess();
    events = new EventBus<DomainEvents>();
    manager = createProjectManager({
      projects: new InMemoryProjectAccess(),
      documents,
      assets,
      externalFiles: files,
      parameters: createParameterEngine(),
      // Meshes and drawings need no geometry kernel.
      interchange: createInterchangeEngine(),
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

    it('keeps project parameters, checked, and tells components about changes', async () => {
      const created = await manager.createProject('Shared');
      if (!created.ok) throw new Error(created.error.message);
      const projectId = created.value.project.id;
      const seen: string[] = [];
      events.subscribe('projectParametersChanged', ({ projectId: id }) => {
        seen.push(id);
      });
      expect(await manager.setProjectParameters(projectId, [{ id: 'a', name: 'wall', expression: '2 mm' }, { id: 'b', name: 'gap', expression: 'wall * 3' }])).toEqual({ ok: true, value: undefined });
      expect((await manager.findProject(projectId))?.parameters?.map((p) => p.name)).toEqual(['wall', 'gap']);
      expect(seen).toEqual([projectId]);
      const cycle = await manager.setProjectParameters(projectId, [{ id: 'a', name: 'wall', expression: 'gap' }, { id: 'b', name: 'gap', expression: 'wall' }]);
      expect(cycle).toMatchObject({ ok: false, error: { code: 'cycle' } });
      expect(seen).toHaveLength(1);
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

    it('previews a mesh file and converts it to another mesh format', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const triangle = ['solid t', 'facet normal 0 0 1', 'outer loop', 'vertex 0 0 0', 'vertex 10 0 0', 'vertex 0 10 0', 'endloop', 'endfacet', 'endsolid t'].join('\n');
      const doc = unwrap(await manager.importFile(project.id, { name: 'tri.stl', bytes: new TextEncoder().encode(triangle) }));
      const content = unwrap(await manager.previewImported(doc.id));
      expect(content).toMatchObject({ kind: 'model', triangles: 1, min: [0, 0, 0], max: [10, 10, 0], usableAsSolid: true });
      unwrap(await manager.exportImported(doc.id, 'obj'));
      expect(files.delivered[0]?.name).toBe('tri.obj');
      expect(new TextDecoder().decode(files.delivered[0]?.bytes)).toContain('f 1 2 3');
    });

    it('previews a drawing as sketch entities and converts it to DXF', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const svg = '<svg viewBox="0 0 40 20" width="40mm" height="20mm"><rect width="40" height="20"/><circle cx="30" cy="10" r="4"/></svg>';
      const doc = unwrap(await manager.importFile(project.id, { name: 'plate.svg', bytes: new TextEncoder().encode(svg) }));
      const content = unwrap(await manager.previewImported(doc.id));
      expect(content.kind === 'drawing' && content.entities.filter((e) => e.kind !== 'point').map((e) => e.kind)).toEqual(['line', 'line', 'line', 'line', 'circle']);
      expect(content).toMatchObject({ min: [0, 0, 0], max: [40, 20, 0] });
      unwrap(await manager.exportImported(doc.id, 'dxf'));
      expect(new TextDecoder().decode(files.delivered[0]?.bytes)).toContain('CIRCLE');
      expect(await manager.exportImported(doc.id, 'stl')).toMatchObject({ ok: false, error: { code: 'unreadable' } });
    });

    it('reports files that cannot be read', async () => {
      const { project } = unwrap(await manager.createProject('P'));
      const doc = unwrap(await manager.importFile(project.id, { name: 'empty.obj', bytes: new TextEncoder().encode('# nothing') }));
      expect(await manager.previewImported(doc.id)).toMatchObject({ ok: false, error: { message: expect.stringContaining('no readable faces') } });
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
