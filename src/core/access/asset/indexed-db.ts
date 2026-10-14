import type { AssetId } from '@core/contracts';
import { KeyValueDatabase } from '@core/utilities/indexed-db';
import type { Asset, AssetAccess } from './asset-access';

const store = 'assets';

export class IndexedDbAssetAccess implements AssetAccess {
  private readonly db: KeyValueDatabase;

  constructor(databaseName = 'cadence-assets', factory?: IDBFactory) {
    this.db = new KeyValueDatabase(databaseName, [{ name: store, keyPath: 'id' }], factory);
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
}
