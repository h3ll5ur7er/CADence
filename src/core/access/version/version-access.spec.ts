import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asProjectId } from '@core/contracts';
import { IndexedDbFileSystem, MemoryFileSystem } from '@core/utilities/file-system';
import { NodeFileSystem } from '@core/utilities/file-system/testing/node-file-system';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, describe, expect, it } from 'vitest';
import { GitVersionAccess } from './git-version-access';
import type { VersionAccess } from './version-access';

const project = asProjectId('p1');
const at = (minute: number) => `2026-10-15T10:${String(minute).padStart(2, '0')}:00.000Z`;

function describeVersionAccess(name: string, create: () => VersionAccess) {
  describe(`${name} (VersionAccess contract)`, () => {
    it('records versions only when the files changed, newest first', async () => {
      const versions = create();
      expect(await versions.versions(project)).toEqual([]);
      const first = await versions.record(project, [{ path: 'documents/a.json', text: '{"v":1}' }, { path: 'project.json', text: '{}' }], 'First', at(1));
      expect(first).toMatch(/^[0-9a-f]{40}$/);
      expect(await versions.record(project, [{ path: 'project.json', text: '{}' }, { path: 'documents/a.json', text: '{"v":1}' }], 'Same', at(2))).toBeUndefined();
      const second = await versions.record(project, [{ path: 'documents/a.json', text: '{"v":2}' }, { path: 'documents/b.json', text: 'b' }, { path: 'project.json', text: '{}' }], 'Second', at(3));
      const third = await versions.record(project, [{ path: 'documents/a.json', text: '{"v":2}' }, { path: 'documents/b.json', text: 'b2' }, { path: 'project.json', text: '{}' }], 'Third', at(4));
      expect((await versions.versions(project)).map((v) => [v.message, v.time])).toEqual([
        ['Third', at(4)],
        ['Second', at(3)],
        ['First', at(1)],
      ]);
      // The versions that changed one file, and the file as it was.
      expect((await versions.versions(project, 'documents/a.json')).map((v) => v.id)).toEqual([second, first]);
      expect(await versions.read(project, first as string, 'documents/a.json')).toBe('{"v":1}');
      expect(await versions.read(project, first as string, 'documents/b.json')).toBeUndefined();
      expect(await versions.read(project, third as string, 'documents/b.json')).toBe('b2');
    });

    it('names versions, moves and removes names, and forgets a project', async () => {
      const versions = create();
      const first = (await versions.record(project, [{ path: 'a', text: '1' }], 'First', at(1))) as string;
      const second = (await versions.record(project, [{ path: 'a', text: '2' }], 'Second', at(2))) as string;
      await versions.name(project, first, 'v1.0');
      expect((await versions.versions(project)).find((v) => v.id === first)?.names).toEqual(['v1.0']);
      await versions.name(project, second, 'v1.0');
      expect((await versions.versions(project)).map((v) => v.names)).toEqual([['v1.0'], []]);
      await expect(versions.name(project, second, 'not a name')).rejects.toThrow('cannot name a version');
      await versions.unname(project, 'v1.0');
      expect((await versions.versions(project)).flatMap((v) => v.names)).toEqual([]);
      await versions.discard(project);
      expect(await versions.versions(project)).toEqual([]);
    });
  });
}

describeVersionAccess('GitVersionAccess in memory', () => new GitVersionAccess(new MemoryFileSystem()));
describeVersionAccess('GitVersionAccess on IndexedDB', () => new GitVersionAccess(new IndexedDbFileSystem('test', new IDBFactory())));

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
describeVersionAccess('GitVersionAccess on disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'cadence-git-'));
  roots.push(root);
  return new GitVersionAccess(new NodeFileSystem(root));
});
