import type { AssetId, DocumentId } from '@core/contracts';
import { KeyValueDatabase } from '@core/utilities/indexed-db';
import type { Asset, AssetAccess, ComponentResult } from './asset-access';

const store = 'assets';

export class IndexedDbAssetAccess implements AssetAccess {
  private readonly db: KeyValueDatabase;
  /** A database of its own, so adding it needed no schema upgrade of the assets database. */
  private readonly results: KeyValueDatabase;

  constructor(databaseName = 'cadence-assets', factory?: IDBFactory) {
    this.db = new KeyValueDatabase(databaseName, [{ name: store, keyPath: 'id' }], factory);
    this.results = new KeyValueDatabase(`${databaseName}-results`, [{ name: 'results', keyPath: 'documentId' }], factory);
  }

  keep(asset: Asset): Promise<void> {
    return this.db.put(store, asset);
  }

  fetch(id: AssetId): Promise<Asset | undefined> {
    return this.db.get<Asset>(store, id);
  }

  release(id: AssetId): Promise<void> {
    return this.db.delete(store, id);
  }

  publishResult(result: ComponentResult): Promise<void> {
    return this.results.put('results', result);
  }

  latestResult(documentId: DocumentId): Promise<ComponentResult | undefined> {
    return this.results.get<ComponentResult>('results', documentId);
  }

  discardResult(documentId: DocumentId): Promise<void> {
    return this.results.delete('results', documentId);
  }
}
