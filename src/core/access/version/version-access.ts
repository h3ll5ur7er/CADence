import type { ProjectId, ProjectRemote, RemoteCredentials, Timestamp, Version } from '@core/contracts';

export type { Version };

/**
 * A file of a project as recorded in a version: a path inside the project and its text, or, for
 * files that never change at their path (imported originals), a way to read their bytes. Those are
 * read only when the latest version does not hold them yet.
 */
export type VersionFile =
  | { readonly path: string; readonly text: string }
  | { readonly path: string; readonly bytes: () => Promise<Uint8Array> };

/** A file of a version history as it is stored (a git repository's own files). */
export interface HistoryFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/**
 * Atomic business verbs over a project's version history (a git repository per project): record the
 * project's files, list and read versions, name them, and exchange them with a remote.
 */
export interface VersionAccess {
  /**
   * Records the files as a new version, unless they equal the latest one; returns the new version's id.
   * With `mergeOf`, the version combines the latest one with that version (recorded even when unchanged).
   */
  record(projectId: ProjectId, files: readonly VersionFile[], message: string, time: Timestamp, mergeOf?: string): Promise<string | undefined>;
  /** Newest first; with `path`, only the versions that changed that file. Versions say whether the remote has them once a remote was fetched. */
  versions(projectId: ProjectId, path?: string): Promise<Version[]>;
  /** The latest version's id; undefined before the first version. */
  latest(projectId: ProjectId): Promise<string | undefined>;
  /** A file as it was in a version; undefined when it did not exist then. */
  read(projectId: ProjectId, version: string, path: string): Promise<string | undefined>;
  readBytes(projectId: ProjectId, version: string, path: string): Promise<Uint8Array | undefined>;
  /** The paths of the files of a version. */
  files(projectId: ProjectId, version: string): Promise<string[]>;
  /** The newest version both have in their history; undefined when their histories are unrelated. */
  commonVersion(projectId: ProjectId, a: string, b: string): Promise<string | undefined>;
  /** Makes a version (a descendant of the latest, e.g. fetched) the latest. */
  advance(projectId: ProjectId, version: string): Promise<void>;
  /** Names a version (a name moves when given again). Names are git tag names: no spaces. */
  name(projectId: ProjectId, version: string, name: string): Promise<void>;
  unname(projectId: ProjectId, name: string): Promise<void>;
  /** Forgets the project's history; unknown projects are ignored. */
  discard(projectId: ProjectId): Promise<void>;
  /** The project's history as files (for archives); empty when it has none. */
  exportHistory(projectId: ProjectId): Promise<HistoryFile[]>;
  /** Takes over a history exported before, in place of the project's own. */
  importHistory(projectId: ProjectId, files: readonly HistoryFile[]): Promise<void>;

  /** Fetches the remote's versions; returns its latest version, undefined when the remote is empty. */
  fetch(projectId: ProjectId, remote: ProjectRemote, credentials?: RemoteCredentials): Promise<string | undefined>;
  /** Sends the versions to the remote; its latest must be in our history. */
  push(projectId: ProjectId, remote: ProjectRemote, credentials?: RemoteCredentials): Promise<void>;
  /**
   * Exchanges version names with the remote (after its versions were exchanged): names only the remote
   * has are taken, names only we have are sent. Returns the names given to different versions on each side.
   */
  syncNames(projectId: ProjectId, remote: ProjectRemote, credentials?: RemoteCredentials): Promise<string[]>;
}

export class InvalidVersionNameError extends Error {
  constructor(name: string) {
    super(`"${name}" cannot name a version: use letters, digits, dots, dashes and underscores, without spaces.`);
  }
}

/** Why a remote could not be used. */
export type RemoteProblem = 'unreachable' | 'unauthorized' | 'rejected';

export class RemoteError extends Error {
  constructor(
    readonly problem: RemoteProblem,
    message: string,
  ) {
    super(message);
  }
}
