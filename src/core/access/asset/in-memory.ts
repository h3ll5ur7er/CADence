import type { AssetId } from '@core/contracts';
import type { Asset, AssetAccess } from './asset-access';

export class InMemoryAssetAccess implements AssetAccess {
  private readonly assets = new Map<AssetId, Asset>();

  async keep(asset: Asset): Promise<void> {
    this.assets.set(asset.id, structuredClone(asset));
  }

  async fetch(id: AssetId): Promise<Asset | undefined> {
    const asset = this.assets.get(id);
    return asset && structuredClone(asset);
  }

  async release(id: AssetId): Promise<void> {
    this.assets.delete(id);
  }
}
