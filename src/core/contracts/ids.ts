declare const brand: unique symbol;

/** A string id that cannot be mixed up with ids of another kind. */
export type Id<Kind extends string> = string & { readonly [brand]: Kind };

export type ProjectId = Id<'project'>;
export type DocumentId = Id<'document'>;
export type AssetId = Id<'asset'>;

export const asProjectId = (value: string) => value as ProjectId;
export const asDocumentId = (value: string) => value as DocumentId;
export const asAssetId = (value: string) => value as AssetId;
