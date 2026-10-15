import type { AssetId, DocumentId } from '@core/contracts';
import { type Asset, type AssetAccess, type ComponentResult, resultKey } from './asset-access';

export class InMemoryAssetAccess implements AssetAccess {
  private readonly assets = new Map<AssetId, Asset>();
  private readonly results = new Map<string, ComponentResult>();

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
    this.results.set(resultKey(result.documentId, result.configuration), structuredClone(result));
  }

  async latestResult(documentId: DocumentId, configuration?: string): Promise<ComponentResult | undefined> {
    const result = this.results.get(resultKey(documentId, configuration));
    return result && structuredClone(result);
  }

  async discardResult(documentId: DocumentId): Promise<void> {
    for (const key of [...this.results.keys()]) if (key === documentId || key.startsWith(`${documentId}@`)) this.results.delete(key);
  }
}
