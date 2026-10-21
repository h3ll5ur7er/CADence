import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { folderChange } from '@core/access/document';
import { InMemoryExternalFileAccess } from '@core/access/external-file';
import type { DocumentId, Result } from '@core/contracts';
import type { StoreChange } from '@core/managers/project';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { afterAll, describe, expect, it } from 'vitest';
import { createDesktopCore } from './index';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('watched project folders (CAD-150)', () => {
  it('tells documents and projects from what lists do not show', () => {
    expect(folderChange('projects/p1/documents/d1.json')).toEqual({ kind: 'document', projectId: 'p1', documentId: 'd1' });
    expect(folderChange('C:\\Users\\me\\AppData\\Roaming\\dev.cadence.app\\projects\\p1\\project.json')).toEqual({ kind: 'project', projectId: 'p1' });
    expect(folderChange('projects/p1/documents/d1.json.x7.tmp')).toBeUndefined();
    expect(folderChange('projects/p1/results/d1')).toBeUndefined();
    expect(folderChange('projects/p1/.git/objects/ab/cdef')).toBeUndefined();
  });

  it('tells the lists what another process changed, created and deleted in the folders', { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'cadence-watch-'));
    roots.push(root);
    let report: (paths: readonly string[]) => void = () => undefined;
    // The app, whose folders are watched, and an agent's MCP server on the same folders.
    const app = createDesktopCore(new NodeFileSystem(root), new InMemoryExternalFileAccess(), { watch: (listener) => (report = listener) });
    const agent = createDesktopCore(new NodeFileSystem(root), new InMemoryExternalFileAccess());

    const { project, firstDocument } = unwrap(await app.projectManager.createProject('Bracket'));
    const design = unwrap(await app.designManager.open(firstDocument.id));
    unwrap(await design.execute({ type: 'add-parameter', parameter: { id: 'w', name: 'width', expression: '10 mm' } }));
    const changes: StoreChange[] = [];
    app.projectManager.watch((change) => changes.push(change));

    // The agent changes the component, adds a document and renames the project.
    const agentDesign = unwrap(await agent.designManager.open(firstDocument.id));
    unwrap(await agentDesign.execute({ type: 'set-parameter', parameter: { id: 'w', name: 'width', expression: '20 mm' } }));
    const added = unwrap(await agent.projectManager.createDocument(project.id, 'assembly', 'Frame'));
    unwrap(await agent.projectManager.renameProject(project.id, 'Bracket II'));
    report([`projects/${project.id}/documents/${firstDocument.id}.json`, `projects/${project.id}/documents/${added.id}.json`, `projects/${project.id}/project.json`, `projects/${project.id}/.git/index`]);
    await expect.poll(() => changes.length).toBe(3);
    expect(changes).toEqual([
      { kind: 'document', documentId: firstDocument.id },
      { kind: 'document', documentId: added.id },
      { kind: 'projects', projectId: project.id },
    ]);
    // A new session of the app reads the agent's version.
    const reopened = unwrap(await app.designManager.open(firstDocument.id));
    expect(reopened.state().document.parameters[0]?.expression).toBe('20 mm');

    // A document the agent deleted for good is gone.
    changes.length = 0;
    await new NodeFileSystem(root).remove(`projects/${project.id}/documents/${added.id}.json`);
    report([`projects/${project.id}/documents/${added.id}.json`]);
    await expect.poll(() => changes.length).toBe(1);
    expect(changes).toEqual([{ kind: 'document', documentId: added.id as DocumentId, gone: true }]);
  });
});
