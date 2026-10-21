import type { CadDocument, DocumentKind, Parameter } from './document';
import type { AssetId, DocumentId, ProjectId } from './ids';

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
  /** When the project was moved to the trash (CAD-148); absent for projects in use. */
  readonly trashedAt?: Timestamp;
  /** The project's documents in the trash, oldest first (CAD-148). */
  readonly trash?: readonly TrashedDocument[];
  /** What the project is about, in Markdown (CAD-149). */
  readonly description?: string;
  /** Photos, datasheets and links kept with the project (CAD-149). */
  readonly attachments?: readonly Attachment[];
  /**
   * The project is a library: other projects use its components (CAD-151). Its `id` is the library's
   * own, kept in its settings, so references find it on every device, in archives and in git.
   */
  readonly library?: { readonly id: string };
}

/** How long the trash keeps what was deleted (CAD-148). */
export const trashDays = 30;

/** A document in its project's trash: its last state is the version `version` of the project's history. */
export interface TrashedDocument {
  readonly id: DocumentId;
  readonly name: string;
  readonly kind: DocumentKind;
  readonly trashedAt: Timestamp;
  readonly version: string;
}

/** What the trash lists: projects, and documents of projects that are not in the trash themselves. */
export type TrashItem =
  | { readonly kind: 'project'; readonly id: ProjectId; readonly name: string; readonly trashedAt: Timestamp; readonly expiresAt: Timestamp; readonly documentCount: number }
  | {
      readonly kind: 'document';
      readonly id: DocumentId;
      readonly name: string;
      readonly documentKind: DocumentKind;
      readonly projectId: ProjectId;
      readonly projectName: string;
      readonly trashedAt: Timestamp;
      readonly expiresAt: Timestamp;
    };

/** A file kept with a project as it is (a photo, a datasheet), or a link (CAD-149). */
export type Attachment =
  | { readonly id: string; readonly kind: 'file'; readonly name: string; readonly mediaType: string; readonly byteLength: number; readonly assetId: AssetId; readonly addedAt: Timestamp }
  | { readonly id: string; readonly kind: 'link'; readonly name: string; readonly url: string; readonly addedAt: Timestamp };

/** The built-in library of standard parts (CAD-152): screws, nuts, washers, inserts and bearings in every size. */
export const standardLibraryId = 'standard';

/** A library other projects can use: a project marked as one, or the built-in standard parts. */
export interface LibrarySummary {
  /** The library's own id (`Project.library.id`, or `standard`). */
  readonly id: string;
  readonly name: string;
  /** The project holding it here; absent for the built-in library. */
  readonly projectId?: ProjectId;
  readonly partCount: number;
}

/** A component a library offers. */
export interface LibraryPart {
  /** Its document id in the library, or a standard part's key (`screw-M3-12`). */
  readonly id: string;
  readonly name: string;
  /** What it is listed under (`Screws (ISO 4762)`). */
  readonly group?: string;
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
}

/** Sign-in for a remote, asked for when syncing and never stored; an access token goes in `password`. */
export interface RemoteCredentials {
  readonly username: string;
  readonly password: string;
}

/** A document (or the project's settings) changed both here and on the remote. */
export interface SyncConflict {
  /** Where it is kept in the version history; resolutions are given by it. */
  readonly path: string;
  readonly name: string;
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
