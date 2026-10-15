import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem } from '@core/utilities/file-system/testing/node-file-system';
import { afterAll } from 'vitest';
import { FileSystemProjectAccess } from './file-system';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbProjectAccess } from './indexed-db';
import { InMemoryProjectAccess } from './in-memory';
import { describeProjectAccessContract } from './testing/project-access.contract';

describeProjectAccessContract('InMemoryProjectAccess', () => new InMemoryProjectAccess());
describeProjectAccessContract(
  'IndexedDbProjectAccess',
  () => new IndexedDbProjectAccess('test', new IDBFactory()),
);

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
describeProjectAccessContract('FileSystemProjectAccess', () => {
  const root = mkdtempSync(join(tmpdir(), 'cadence-'));
  roots.push(root);
  return new FileSystemProjectAccess(new NodeFileSystem(root));
});
