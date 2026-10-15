import type { Parameter } from './document';
import type { ProjectId } from './ids';

/** ISO 8601 timestamp, e.g. `2026-10-14T18:00:00.000Z`. */
export type Timestamp = string;

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: Timestamp;
  readonly modifiedAt: Timestamp;
  /** Parameters every component of the project can use; a component's own parameter of the same name wins. */
  readonly parameters?: readonly Parameter[];
}

/**
 * What a component result was made from: the component's last change and the project parameters it
 * used. A result with another stamp is stale.
 */
export function resultStamp(modifiedAt: Timestamp, projectParameters: readonly Parameter[] = []): string {
  if (!projectParameters.length) return modifiedAt;
  // A short, stable hash of the parameters (FNV-1a), so the stamp stays small.
  let hash = 0x811c9dc5;
  for (const char of projectParameters.map((p) => `${p.name}=${p.expression}`).join(';')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${modifiedAt}#${hash.toString(36)}`;
}

export interface ProjectSummary extends Project {
  readonly documentCount: number;
}
