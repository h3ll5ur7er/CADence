import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Who may do what with a project: owners also share it, editors change it, viewers read it. */
export type Role = 'owner' | 'editor' | 'viewer';
const ranks: Readonly<Record<Role, number>> = { viewer: 1, editor: 2, owner: 3 };
export const atLeast = (role: Role | undefined, needed: Role): boolean => !!role && ranks[role] >= ranks[needed];

export interface User {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  /** Where the user signs in: `github:<id>`, `google:<sub>`, `dev:<name>`. */
  readonly identity: string;
}

export interface ServerProject {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** Members by user id. */
  readonly members: Readonly<Record<string, Role>>;
  /** Links anyone may use to view the project, by token. */
  readonly links: Readonly<Record<string, { readonly role: 'viewer'; readonly createdAt: string }>>;
}

interface Data {
  users: User[];
  /** Sign-ins by the SHA-256 of their token. */
  sessions: Record<string, { readonly user: string; readonly createdAt: string }>;
  projects: ServerProject[];
}

export const newToken = (): string => randomBytes(32).toString('base64url');
export const newId = (): string => randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');
const digest = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The server's accounts, sign-ins and projects, kept in one JSON file (written whole, through a
 * temporary file, so it is never half written). Enough for the people of one workshop or club.
 */
export class Store {
  private readonly file: string;
  private data: Data;

  constructor(readonly folder: string) {
    mkdirSync(folder, { recursive: true });
    this.file = join(folder, 'server.json');
    try {
      this.data = JSON.parse(readFileSync(this.file, 'utf8')) as Data;
    } catch {
      this.data = { users: [], sessions: {}, projects: [] };
    }
  }

  private save(): void {
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
  }

  /** The user signing in with an identity, made the first time (names and e-mail follow the provider). */
  signedIn(identity: string, name: string, email?: string): User {
    const index = this.data.users.findIndex((u) => u.identity === identity);
    const user: User = { id: this.data.users[index]?.id ?? newId(), identity, name, ...(email ? { email } : {}) };
    if (index < 0) this.data.users.push(user);
    else this.data.users[index] = user;
    this.save();
    return user;
  }

  /** A new sign-in for a user; returns its token, which is kept only as a hash. */
  startSession(user: User): string {
    const token = newToken();
    this.data.sessions[digest(token)] = { user: user.id, createdAt: new Date().toISOString() };
    this.save();
    return token;
  }

  endSession(token: string): void {
    delete this.data.sessions[digest(token)];
    this.save();
  }

  userOf(token: string | undefined): User | undefined {
    const session = token ? this.data.sessions[digest(token)] : undefined;
    return session ? this.data.users.find((u) => u.id === session.user) : undefined;
  }

  user(id: string): User | undefined {
    return this.data.users.find((u) => u.id === id);
  }

  /** A user by id, e-mail address or name, to invite. */
  findUser(who: string): User | undefined {
    const wanted = who.trim().toLowerCase();
    return this.data.users.find((u) => u.id === who) ?? this.data.users.find((u) => u.email?.toLowerCase() === wanted) ?? this.data.users.find((u) => u.name.toLowerCase() === wanted);
  }

  createProject(owner: User, name: string): ServerProject {
    const project: ServerProject = { id: newId(), name, createdAt: new Date().toISOString(), members: { [owner.id]: 'owner' }, links: {} };
    this.data.projects.push(project);
    this.save();
    return project;
  }

  project(id: string): ServerProject | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  projectsOf(user: User): ServerProject[] {
    return this.data.projects.filter((p) => p.members[user.id]);
  }

  /** The project a view link belongs to. */
  projectOfLink(token: string): ServerProject | undefined {
    return this.data.projects.find((p) => p.links[token]);
  }

  revise(project: ServerProject): void {
    this.data.projects = this.data.projects.map((p) => (p.id === project.id ? project : p));
    this.save();
  }

  /** What a token may do with a project: a member's sign-in, or a link to it. */
  roleOf(project: ServerProject, token: string | undefined): { role: Role; user?: User } | undefined {
    if (!token) return undefined;
    const user = this.userOf(token);
    const role = user ? project.members[user.id] : undefined;
    if (user && role) return { role, user };
    const link = project.links[token];
    return link ? { role: link.role } : undefined;
  }
}
