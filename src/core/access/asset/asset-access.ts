import type { AssetId, ProjectId } from '@core/contracts';

export interface AssetMeta {
  readonly id: AssetId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly byteLength: number;
}

export interface Asset extends AssetMeta {
  readonly bytes: Uint8Array;
}

/** Atomic business verbs over the blob store (imported originals, later published results). */
export interface AssetAccess {
  keep(asset: Asset): Promise<void>;
  fetch(id: AssetId): Promise<Asset | undefined>;
  /** Removes the blob; unknown ids are ignored. */
  release(id: AssetId): Promise<void>;
}
