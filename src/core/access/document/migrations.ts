import { type CadDocument, currentSchemaVersion, type DocumentSummary, summarize } from '@core/contracts';

/** A pure upgrade from schema version `n` to `n + 1`, indexed by `n`. */
export type Migration = (document: Record<string, unknown>) => Record<string, unknown>;

export class UnsupportedSchemaError extends Error {
  constructor(version: unknown) {
    super(`This document was saved by a newer CADence (schema ${String(version)}; this app reads up to ${currentSchemaVersion}). Update CADence to open it: an older app would show it wrongly.`);
  }
}

/** The schema history (docs/Architecture/Document-model.md#schema-versioning). */
export const documentMigrations: Readonly<Record<number, Migration>> = {
  1: (document) => (document['kind'] === 'assembly' ? { ...document, motionStudies: [] } : document),
  // Fields added since (joint leans, view configurations, …) are optional: nothing to change.
  2: (document) => document,
  // Nothing to change: new, optional fields and kinds an older app would ignore and show wrongly: reference dimensions,
  // blocks and wraps (phase 35); drill points, ribs up to the next face, nested folders, bodies' own materials
  // (CAD-156 to CAD-158); gear profile shifts, bevel gears, worms, springs, helices and their links (phase 37); hems,
  // miter flanges and corner reliefs (CAD-162, CAD-163); plugin features (CAD-174); universal, driven and
  // cone-limited joints and offsets with expressions (phase 44); studies' targets and carried parts (phase 45).
  3: (document) => document,
};

/**
 * A stored document's summary, also of one saved by a newer CADence: the fields of summaries do not
 * change, so a project lists such documents, and only opening them is refused (CAD-145).
 */
export function summaryOf(raw: Record<string, unknown>): DocumentSummary {
  const version = Number(raw['schemaVersion'] ?? 1);
  return summarize((Number.isInteger(version) && version > currentSchemaVersion ? raw : migrate(raw)) as unknown as CadDocument);
}

/** Upgrades a stored document to the current schema version. */
export function migrate(
  raw: Record<string, unknown>,
  migrations: Readonly<Record<number, Migration>> = documentMigrations,
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
