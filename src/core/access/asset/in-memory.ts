import type { AssetId, DocumentId } from '@core/contracts';
import type { Asset, AssetAccess, ComponentResult } from './asset-access';

export class InMemoryAssetAccess implements AssetAccess {
  private readonly assets = new Map<AssetId, Asset>();
  private readonly results = new Map<DocumentId, ComponentResult>();

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

  async publishResult(result: ComponentResult): Promise<void> {
    this.results.set(result.documentId, structuredClone(result));
  }

  async latestResult(documentId: DocumentId): Promise<ComponentResult | undefined> {
    const result = this.results.get(documentId);
    return result && structuredClone(result);
  }

  async discardResult(documentId: DocumentId): Promise<void> {
    this.results.delete(documentId);
  }
}
