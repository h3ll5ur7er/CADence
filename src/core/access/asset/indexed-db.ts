import type { AssetId, DocumentId } from '@core/contracts';
import { KeyValueDatabase } from '@core/utilities/indexed-db';
import { type Asset, type AssetAccess, type ComponentResult, resultKey } from './asset-access';

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

  // Results are stored under their result key in the `documentId` key path (no schema upgrade needed).
  publishResult(result: ComponentResult): Promise<void> {
    return this.results.put('results', { ...result, documentId: resultKey(result.documentId, result.configuration) });
  }

  async latestResult(documentId: DocumentId, configuration?: string): Promise<ComponentResult | undefined> {
    const stored = await this.results.get<ComponentResult>('results', resultKey(documentId, configuration));
    return stored && { ...stored, documentId };
  }

  async discardResult(documentId: DocumentId): Promise<void> {
    // Results are a small cache: listing them is cheap.
    const stored = await this.results.getAll<ComponentResult>('results');
    for (const { documentId: key } of stored) if (key === documentId || key.startsWith(`${documentId}@`)) await this.results.delete('results', key);
  }
}
