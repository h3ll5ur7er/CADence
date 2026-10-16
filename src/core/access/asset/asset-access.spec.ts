import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { asDocumentId, asProjectId } from '@core/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import { FileSystemAssetAccess } from './file-system';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbAssetAccess } from './indexed-db';
import { InMemoryAssetAccess } from './in-memory';
import { describeAssetAccessContract } from './testing/asset-access.contract';

describeAssetAccessContract('InMemoryAssetAccess', () => new InMemoryAssetAccess());
describeAssetAccessContract('IndexedDbAssetAccess', () => new IndexedDbAssetAccess('test', new IDBFactory()));

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
describeAssetAccessContract('FileSystemAssetAccess', () => {
  const root = mkdtempSync(join(tmpdir(), 'cadence-'));
  roots.push(root);
  return new FileSystemAssetAccess(new NodeFileSystem(root));
});

describe('FileSystemAssetAccess', () => {
  it('counts a result whose metadata is empty or cut short as missing (CAD-119)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cadence-'));
    roots.push(root);
    const files = new NodeFileSystem(root);
    const access = new FileSystemAssetAccess(files);
    const result = { documentId: asDocumentId('head'), projectId: asProjectId('p'), stamp: 't1', bytes: new Uint8Array([1, 2]) };
    await access.publishResult(result);
    await files.writeText('projects/p/results/head.json', '');
    expect(await access.latestResult(asDocumentId('head'))).toBeUndefined();
    await files.writeText('projects/p/results/head.json', '{"documentId":"he');
    expect(await access.latestResult(asDocumentId('head'))).toBeUndefined();
    // Published again, it is there; writes leave no temporary files behind.
    await access.publishResult(result);
    expect((await access.latestResult(asDocumentId('head')))?.stamp).toBe('t1');
    expect((await files.list('projects/p/results')).sort()).toEqual(['head.bin', 'head.json']);
  });
});
