import type { ProjectId } from './ids';

/** ISO 8601 timestamp, e.g. `2026-10-14T18:00:00.000Z`. */
export type Timestamp = string;

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: Timestamp;
  readonly modifiedAt: Timestamp;
}

export interface ProjectSummary extends Project {
  readonly documentCount: number;
}
