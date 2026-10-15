import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { afterAll } from 'vitest';
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
