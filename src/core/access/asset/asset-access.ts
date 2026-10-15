import type { AssetId, DocumentId, ProjectId } from '@core/contracts';

export interface AssetMeta {
  readonly id: AssetId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly byteLength: number;
}

export interface Asset extends AssetMeta {
  readonly bytes: Uint8Array;
}

/**
 * A component's published result (docs/Architecture/Decisions.md#adr-11): its solids as the Modeling
 * Engine snapshots them. It is a cache, so losing it is always safe.
 */
export interface ComponentResult {
  readonly documentId: DocumentId;
  readonly projectId: ProjectId;
  /** The component's `modifiedAt` when the result was made; a different one means the result is stale. */
  readonly stamp: string;
  readonly bytes: Uint8Array;
}

/** Atomic business verbs over the blob store: imported originals and published component results. */
export interface AssetAccess {
  keep(asset: Asset): Promise<void>;
  fetch(id: AssetId): Promise<Asset | undefined>;
  /** Removes the blob; unknown ids are ignored. */
  release(id: AssetId): Promise<void>;
  /** Replaces the component's result. */
  publishResult(result: ComponentResult): Promise<void>;
  latestResult(documentId: DocumentId): Promise<ComponentResult | undefined>;
  /** Unknown documents are ignored. */
  discardResult(documentId: DocumentId): Promise<void>;
}
