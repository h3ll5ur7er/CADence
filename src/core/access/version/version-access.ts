import type { ProjectId, Timestamp, Version } from '@core/contracts';

export type { Version };

/** A file of a project as recorded in a version: a path inside the project and its text. */
export interface VersionFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Atomic business verbs over a project's version history (a git repository per project): record the
 * project's files, list and read versions, and name them.
 */
export interface VersionAccess {
  /** Records the files as a new version, unless they equal the latest one; returns the new version's id. */
  record(projectId: ProjectId, files: readonly VersionFile[], message: string, time: Timestamp): Promise<string | undefined>;
  /** Newest first; with `path`, only the versions that changed that file. */
  versions(projectId: ProjectId, path?: string): Promise<Version[]>;
  /** A file as it was in a version; undefined when it did not exist then. */
  read(projectId: ProjectId, version: string, path: string): Promise<string | undefined>;
  /** Names a version (a name moves when given again). Names are git tag names: no spaces. */
  name(projectId: ProjectId, version: string, name: string): Promise<void>;
  unname(projectId: ProjectId, name: string): Promise<void>;
  /** Forgets the project's history; unknown projects are ignored. */
  discard(projectId: ProjectId): Promise<void>;
}

export class InvalidVersionNameError extends Error {
  constructor(name: string) {
    super(`"${name}" cannot name a version: use letters, digits, dots, dashes and underscores, without spaces.`);
  }
}
