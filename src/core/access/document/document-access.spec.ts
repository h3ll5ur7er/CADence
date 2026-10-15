import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { afterAll } from 'vitest';
import { FileSystemDocumentAccess } from './file-system';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDocumentAccess } from './indexed-db';
import { InMemoryDocumentAccess } from './in-memory';
import { describeDocumentAccessContract } from './testing/document-access.contract';

describeDocumentAccessContract('InMemoryDocumentAccess', () => new InMemoryDocumentAccess());
describeDocumentAccessContract(
  'IndexedDbDocumentAccess',
  () => new IndexedDbDocumentAccess('test', new IDBFactory()),
);

const roots: string[] = [];
afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
describeDocumentAccessContract('FileSystemDocumentAccess', () => {
  const root = mkdtempSync(join(tmpdir(), 'cadence-'));
  roots.push(root);
  return new FileSystemDocumentAccess(new NodeFileSystem(root));
});
