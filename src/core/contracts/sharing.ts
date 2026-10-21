/**
 * Projects shared on a CADence server, and live editing through its relay
 * (docs/Architecture/Decisions.md#adr-61a, docs/Architecture/Server.md).
 */
import type { Vec2 } from './sketch';

/** What someone may do with a shared project: owners also share it, editors change it, viewers look. */
export type ProjectRole = 'owner' | 'editor' | 'viewer';

/** A sign-in to a CADence server: its address, and the token it gave (kept by the client). */
export interface ServerSignIn {
  readonly server: string;
  readonly token: string;
}

/** Who is signed in. */
export interface ServerUser {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
}

/** A server's ways to sign in: OAuth providers, and `dev` (a name only, on private servers). */
export interface ServerInfo {
  readonly name: string;
  readonly providers: readonly { readonly id: string; readonly label: string }[];
}

/** A project on a server, as one of its members sees it. */
export interface SharedProject {
  readonly id: string;
  readonly name: string;
  readonly role: ProjectRole;
  /** The git repository its versions are synced with. */
  readonly git: string;
  /** For editors and owners. */
  readonly members?: readonly { readonly id: string; readonly name: string; readonly email?: string; readonly role: ProjectRole }[];
  /** For owners: the links that let anyone view it. */
  readonly links?: readonly { readonly token: string; readonly createdAt: string }[];
}

/** A person editing live: who, in which colour. */
export interface LiveUser {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Where someone works in a document: the sketch they edit, the item they look at, the point under their pointer. */
export interface LiveWhere {
  readonly sketch?: string;
  readonly item?: string;
  /** In the sketch's plane. */
  readonly point?: Vec2;
}

/**
 * What a client sends to a live document: a command (a Design command), or the whole document
 * (after an undo, or a merge with what changed while the client was away). `ref` numbers a client's
 * sends, so it knows its own when they come back.
 */
export type LivePayload =
  | { readonly kind: 'command'; readonly ref: number; readonly command: unknown }
  | { readonly kind: 'document'; readonly ref: number; readonly document: unknown };

/** A payload as the relay ordered it. */
export interface LiveEntry {
  readonly seq: number;
  readonly clientId: string;
  readonly user: LiveUser;
  readonly payload: LivePayload;
}

export interface LivePresence {
  readonly clientId: string;
  readonly user: LiveUser;
  readonly where: LiveWhere;
}

/** What the relay sends a client, in order. */
export type LiveEvent =
  /**
   * First: the entries after the client's last one, and who is there. `reset` when the client is
   * behind the room's snapshot (it starts from `snapshot`) or ahead of a room that started again
   * (no snapshot: the client brings its document).
   */
  | {
      readonly kind: 'welcome';
      readonly seq: number;
      readonly snapshot?: { readonly seq: number; readonly document: unknown };
      readonly entries: readonly LiveEntry[];
      readonly present: readonly LivePresence[];
      readonly reset?: boolean;
    }
  | { readonly kind: 'entry'; readonly entry: LiveEntry }
  | { readonly kind: 'presence'; readonly presence: LivePresence }
  | { readonly kind: 'left'; readonly clientId: string }
  /** The room holds many entries: a client sends its document as of `seq` (or later). */
  | { readonly kind: 'snapshot-wanted'; readonly seq: number };
