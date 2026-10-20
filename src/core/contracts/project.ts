import type { CadDocument, Parameter } from './document';
import type { ProjectId } from './ids';
import type { ItemConflict } from './revision';
import type { ProjectRole } from './sharing';

/** ISO 8601 timestamp, e.g. `2026-10-14T18:00:00.000Z`. */
export type Timestamp = string;

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly createdAt: Timestamp;
  readonly modifiedAt: Timestamp;
  /** Parameters every component of the project can use; a component's own parameter of the same name wins. */
  readonly parameters?: readonly Parameter[];
  /** Where the project's versions are shared, when they are. */
  readonly remote?: ProjectRemote;
  /**
   * A copy (imported beside its original, or duplicated) keeps the original's history: the ids its
   * documents and originals had there, by their ids here (oldest last), so restoring finds them (CAD-147).
   */
  readonly copiedFrom?: Readonly<Record<string, readonly string[]>>;
}

/** A starting point for new projects: settings and documents, made with CADence (public/templates). */
export interface ProjectTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly Parameter[];
  readonly documents: readonly CadDocument[];
}

/** A git repository over HTTPS that a project's versions are synced with. */
export interface ProjectRemote {
  readonly url: string;
  /** A CORS proxy for hosts a browser cannot reach directly (e.g. https://cors.isomorphic-git.org). */
  readonly corsProxy?: string;
  /** When the repository is a project on a CADence server (CAD-177): which, and what this device may do with it. */
  readonly server?: {
    readonly url: string;
    readonly project: string;
    readonly role: ProjectRole;
    /** Opened through a link to view: the link, which is also its sign-in. */
    readonly link?: string;
  };
}

/** Sign-in for a remote, asked for when syncing and never stored; an access token goes in `password`. */
export interface RemoteCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * A document (or the project's settings) changed both here and on the remote, in ways that do not
 * merge on their own. Resolutions are given for the whole document by its `path` (`mine` or `theirs`
 * throughout), or per item by `<path>#<item path>`.
 */
export interface SyncConflict {
  /** Where it is kept in the version history. */
  readonly path: string;
  readonly name: string;
  /**
   * The items both sides changed differently (CAD-176); everything else of the document merges.
   * Absent when the document cannot be merged item by item (deleted on one side).
   */
  readonly items?: readonly ItemConflict[];
}

/** Which side of a conflict to keep. */
export type ConflictChoice = 'mine' | 'theirs';

export type SyncOutcome =
  /**
   * Nothing to do / sent our versions / took theirs / combined both and sent the result. Version names
   * travel too; a name given to different versions here and on the remote stays as it is on each side.
   */
  | { readonly kind: 'up-to-date' | 'pushed' | 'pulled' | 'merged'; readonly nameConflicts?: readonly string[] }
  /** Both sides changed these; sync again with a choice for each. */
  | { readonly kind: 'conflicts'; readonly conflicts: readonly SyncConflict[] };

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

/** One recorded state of a project in its version history. */
export interface Version {
  readonly id: string;
  readonly time: Timestamp;
  readonly message: string;
  /** Names the user gave this version. */
  readonly names: readonly string[];
  /** The project's remote has this version (as of the last sync); absent for projects that are not synced. */
  readonly shared?: boolean;
}

export interface ProjectSummary extends Project {
  readonly documentCount: number;
}
