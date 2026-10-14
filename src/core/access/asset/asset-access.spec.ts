import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbAssetAccess } from './indexed-db';
import { InMemoryAssetAccess } from './in-memory';
import { describeAssetAccessContract } from './testing/asset-access.contract';

describeAssetAccessContract('InMemoryAssetAccess', () => new InMemoryAssetAccess());
describeAssetAccessContract('IndexedDbAssetAccess', () => new IndexedDbAssetAccess('test', new IDBFactory()));
