import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asProjectId } from '@core/contracts';
import { IndexedDbFileSystem, MemoryFileSystem } from '@core/utilities/file-system';
import { NodeFileSystem } from '@core/utilities/file-system/testing/node-file-system';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GitVersionAccess } from './git-version-access';
import { GitHttpServer } from './testing/git-http-server';
import { RemoteError, type VersionAccess } from './version-access';

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

    it('keeps files that never change once, and lists and reads a version', async () => {
      const versions = create();
      const bytes = vi.fn(async () => new Uint8Array([0, 1, 2, 255]));
      const first = (await versions.record(project, [{ path: 'originals/x', bytes }, { path: 'a', text: '1' }], 'First', at(1))) as string;
      await versions.record(project, [{ path: 'originals/x', bytes }, { path: 'a', text: '2' }], 'Second', at(2));
      expect(bytes).toHaveBeenCalledTimes(1);
      expect([...((await versions.readBytes(project, first, 'originals/x')) ?? [])]).toEqual([0, 1, 2, 255]);
      expect((await versions.files(project, first)).sort()).toEqual(['a', 'originals/x']);
      expect(await versions.latest(project)).not.toBe(first);
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

describe('GitVersionAccess with a remote (git over HTTP)', () => {
  let server: GitHttpServer;
  beforeAll(async () => {
    server = await GitHttpServer.start();
  });
  afterAll(() => server.stop());
  const device = () => new GitVersionAccess(new MemoryFileSystem());

  it('pushes, fetches and fast-forwards between two devices', async () => {
    const remote = { url: server.repository('shared') };
    const [here, there] = [device(), device()];
    expect(await there.fetch(project, remote)).toBeUndefined();
    const first = (await here.record(project, [{ path: 'a', text: '1' }], 'First', at(1))) as string;
    await here.push(project, remote);
    expect(server.log('shared')).toEqual(['First']);

    expect(await there.fetch(project, remote)).toBe(first);
    await there.advance(project, first);
    expect(await there.read(project, first, 'a')).toBe('1');
    const second = (await there.record(project, [{ path: 'a', text: '2' }], 'Second', at(2))) as string;
    await there.push(project, remote);

    expect(await here.fetch(project, remote)).toBe(second);
    expect(await here.commonVersion(project, first, second)).toBe(first);
    await here.advance(project, second);
    expect((await here.versions(project)).map((v) => v.message)).toEqual(['Second', 'First']);
  });

  it('refuses a push behind the remote; a merge version then goes through', async () => {
    const remote = { url: server.repository('diverged') };
    const [here, there] = [device(), device()];
    const base = (await here.record(project, [{ path: 'a', text: '1' }, { path: 'b', text: '1' }], 'Base', at(1))) as string;
    await here.push(project, remote);
    await there.advance(project, (await there.fetch(project, remote)) as string);
    await here.record(project, [{ path: 'a', text: 'here' }, { path: 'b', text: '1' }], 'Here', at(2));
    await here.push(project, remote);
    await there.record(project, [{ path: 'a', text: '1' }, { path: 'b', text: 'there' }], 'There', at(3));
    await expect(there.push(project, remote)).rejects.toMatchObject({ problem: 'rejected' });

    const theirs = (await there.fetch(project, remote)) as string;
    expect(await there.commonVersion(project, (await there.latest(project)) as string, theirs)).toBe(base);
    await there.record(project, [{ path: 'a', text: 'here' }, { path: 'b', text: 'there' }], 'Merged', at(4), theirs);
    await there.push(project, remote);
    expect(server.log('diverged')).toEqual(['Merged', 'There', 'Here', 'Base']);
  });

  it('signs in when the remote asks, and tells unreachable remotes apart', async () => {
    const guarded = await GitHttpServer.start({ username: 'ada', password: 'token-1' });
    try {
      const remote = { url: guarded.repository('private') };
      const here = device();
      await here.record(project, [{ path: 'a', text: '1' }], 'First', at(1));
      await expect(here.push(project, remote)).rejects.toMatchObject({ problem: 'unauthorized' });
      await expect(here.push(project, remote, { username: 'ada', password: 'wrong' })).rejects.toMatchObject({ problem: 'unauthorized' });
      await here.push(project, remote, { username: 'ada', password: 'token-1' });
      expect(guarded.log('private')).toEqual(['First']);
    } finally {
      await guarded.stop();
    }
    const unreachable = device().fetch(project, { url: 'http://127.0.0.1:9/nothing.git' });
    await expect(unreachable).rejects.toBeInstanceOf(RemoteError);
    await expect(unreachable).rejects.toMatchObject({ problem: 'unreachable' });
  });
});
