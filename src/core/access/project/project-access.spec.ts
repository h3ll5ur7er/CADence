import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbProjectAccess } from './indexed-db';
import { InMemoryProjectAccess } from './in-memory';
import { describeProjectAccessContract } from './testing/project-access.contract';

describeProjectAccessContract('InMemoryProjectAccess', () => new InMemoryProjectAccess());
describeProjectAccessContract(
  'IndexedDbProjectAccess',
  () => new IndexedDbProjectAccess('test', new IDBFactory()),
);
