import type { LiveEvent, LivePayload, LiveWhere, ProjectRole, ServerInfo, ServerSignIn, ServerUser, SharedProject } from '@core/contracts';

/** Why a CADence server could not be used. */
export type ServerProblem = 'unreachable' | 'unauthorized' | 'forbidden' | 'not-found' | 'rejected';

export class ServerError extends Error {
  constructor(
    readonly problem: ServerProblem,
    message: string,
  ) {
    super(message);
  }
}

/** A project's room for live editing of one document. */
export interface LiveRoom {
  readonly server: string;
  readonly project: string;
  readonly document: string;
  /** A member's sign-in, or the link the project was opened with. */
  readonly token: string;
  readonly clientId: string;
}

/** A client's connection to a live room; it reconnects by itself, from `after()`. */
export interface LiveConnection {
  /** Sends a payload; resolves with its place in the room's order. Fails while offline. */
  send(payload: LivePayload): Promise<number>;
  present(where: LiveWhere): Promise<void>;
  /** The client's document as of `seq`, so the room can drop the entries before it; whether the room kept it. */
  snapshot(seq: number, document: unknown): Promise<boolean>;
  /** Drops the stream and connects again (from `after()`). */
  reconnect(): void;
  close(): void;
}

export interface LiveListener {
  event(event: LiveEvent): void;
  status(status: 'connecting' | 'live' | 'offline'): void;
  /** The last entry the client has, to catch up from on (re)connecting; -1 for none. */
  after(): number;
}

/**
 * Atomic business verbs over a CADence server (CAD-177, CAD-178): who is signed in, its projects,
 * their members and view links, and its relay for live editing.
 */
export interface ServerAccess {
  info(server: string): Promise<ServerInfo>;
  /** On servers that allow it, signing in by name alone. */
  signInByName(server: string, name: string): Promise<ServerSignIn>;
  user(signIn: ServerSignIn): Promise<ServerUser>;
  signOut(signIn: ServerSignIn): Promise<void>;
  projects(signIn: ServerSignIn): Promise<SharedProject[]>;
  createProject(signIn: ServerSignIn, name: string): Promise<SharedProject>;
  project(signIn: ServerSignIn, id: string): Promise<SharedProject>;
  /** Adds or changes a member: someone who signed in to the server once, by name, e-mail address or id. */
  setMember(signIn: ServerSignIn, id: string, who: string, role: ProjectRole): Promise<SharedProject>;
  removeMember(signIn: ServerSignIn, id: string, userId: string): Promise<SharedProject>;
  addLink(signIn: ServerSignIn, id: string): Promise<SharedProject>;
  removeLink(signIn: ServerSignIn, id: string, token: string): Promise<SharedProject>;
  /** The project a view link opens. */
  link(server: string, token: string): Promise<{ readonly project: { readonly id: string; readonly name: string }; readonly git: string }>;
  join(room: LiveRoom, listener: LiveListener): LiveConnection;
}
