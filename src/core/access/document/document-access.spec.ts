import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDocumentAccess } from './indexed-db';
import { InMemoryDocumentAccess } from './in-memory';
import { describeDocumentAccessContract } from './testing/document-access.contract';

describeDocumentAccessContract('InMemoryDocumentAccess', () => new InMemoryDocumentAccess());
describeDocumentAccessContract(
  'IndexedDbDocumentAccess',
  () => new IndexedDbDocumentAccess('test', new IDBFactory()),
);
