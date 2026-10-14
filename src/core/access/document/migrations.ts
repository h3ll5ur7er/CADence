import { type CadDocument, currentSchemaVersion } from '@core/contracts';

/** A pure upgrade from schema version `n` to `n + 1`, indexed by `n`. */
export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

export class UnsupportedSchemaError extends Error {
  constructor(version: unknown) {
    super(`Document schema version ${String(version)} is newer than this app supports (${currentSchemaVersion})`);
  }
}

/** Upgrades a stored document to the current schema version. */
export function migrate(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = {},
  target = currentSchemaVersion,
): CadDocument {
  let document = raw;
  let version = Number(document['schemaVersion'] ?? 1);
  if (!Number.isInteger(version) || version > target) throw new UnsupportedSchemaError(document['schemaVersion']);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new Error(`Missing document migration from schema version ${version}`);
    document = { ...step(document), schemaVersion: version + 1 };
    version += 1;
  }
  return document as unknown as CadDocument;
}
