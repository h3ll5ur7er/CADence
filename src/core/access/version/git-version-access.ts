import type { ProjectId, ProjectRemote, RemoteCredentials, Timestamp } from '@core/contracts';
import type * as IsomorphicGit from 'isomorphic-git';
import type { HttpClient } from 'isomorphic-git';
import { type FileSystem, joinPath } from '@core/utilities/file-system';
import { type HistoryFile, InvalidVersionNameError, RemoteError, type Version, type VersionAccess, type VersionFile } from './version-access';

type Git = typeof IsomorphicGit;

/** isomorphic-git, with the global Buffer it expects, loaded on first use. */
let loaded: Promise<Git> | undefined;
function loadGit(): Promise<Git> {
  loaded ??= (async () => {
    // A CommonJS package: bundlers hand it over as named exports or as the default export.
    const buffer = (await import('buffer')) as { Buffer?: unknown; default?: { Buffer?: unknown } };
    (globalThis as { Buffer?: unknown }).Buffer ??= buffer.Buffer ?? buffer.default?.Buffer;
    return import('isomorphic-git');
  })();
  return loaded;
}

/** isomorphic-git's HTTP client over `fetch`, loaded when a remote is first used. */
let loadedHttp: Promise<HttpClient> | undefined;
const loadHttp = () => (loadedHttp ??= import('isomorphic-git/http/web').then((m) => m.default));

/** What a remote's failure means to the user. */
function remoteError(error: unknown, url: string): RemoteError {
  const { code, data } = error as { code?: string; data?: { statusCode?: number } };
  if (code === 'HttpError' && (data?.statusCode === 401 || data?.statusCode === 403)) {
    return new RemoteError('unauthorized', `${url} did not accept the sign-in. Check the user name and the password or access token.`);
  }
  if (code === 'PushRejectedError' || code === 'GitPushError') {
    return new RemoteError('rejected', `${url} did not take the versions: ${(error as Error).message}`);
  }
  return new RemoteError('unreachable', `${url} could not be reached (${(error as Error).message}). In the browser, a CORS proxy may help.`);
}

/** A Buffer of the bytes: isomorphic-git reads files as Buffers (set globally by `loadGit`). */
const asBuffer = (bytes: Uint8Array) => (globalThis as unknown as { Buffer: { from(bytes: Uint8Array): Uint8Array } }).Buffer.from(bytes);

const missing = (path: string) => Object.assign(new Error(`ENOENT: no such file or directory, '${path}'`), { code: 'ENOENT' });
const clean = (path: string) => path.replace(/^\.\//, '').replace(/\/+$/, '');

/** The node-style `fs.promises` that isomorphic-git works on, over a FileSystem. */
function gitFs(fs: FileSystem) {
  const stat = async (raw: string) => {
    const path = clean(raw);
    if (!(await fs.exists(path))) throw missing(path);
    const directory = await fs.isDirectory(path);
    const size = directory ? 0 : (await fs.readBytes(path)).length;
    return {
      type: directory ? 'dir' : 'file',
      mode: directory ? 0o40000 : 0o100644,
      size,
      ino: 0,
      mtimeMs: 0,
      ctimeMs: 0,
      uid: 0,
      gid: 0,
      dev: 0,
      isFile: () => !directory,
      isDirectory: () => directory,
      isSymbolicLink: () => false,
    };
  };
  return {
    promises: {
      async readFile(raw: string, options?: { encoding?: string } | string) {
        const path = clean(raw);
        if (!(await fs.exists(path)) || (await fs.isDirectory(path))) throw missing(path);
        const bytes = await fs.readBytes(path);
        const encoding = typeof options === 'string' ? options : options?.encoding;
        return encoding ? new TextDecoder().decode(bytes) : asBuffer(bytes);
      },
      async writeFile(raw: string, data: Uint8Array | string) {
        await fs.writeBytes(clean(raw), typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
      },
      async unlink(raw: string) {
        const path = clean(raw);
        if (!(await fs.exists(path))) throw missing(path);
        await fs.remove(path);
      },
      async readdir(raw: string) {
        const path = clean(raw);
        if (!(await fs.isDirectory(path))) throw missing(path);
        return fs.list(path);
      },
      async mkdir(raw: string) {
        await fs.makeDirectory(clean(raw));
      },
      async rmdir(raw: string) {
        await fs.remove(clean(raw));
      },
      stat,
      lstat: stat,
      async readlink(raw: string): Promise<never> {
        throw missing(raw);
      },
      async symlink(): Promise<void> {
        throw new Error('Version histories hold no symbolic links.');
      },
      // Modes do not matter for the files kept here.
      chmod: () => Promise.resolve(),
    },
  };
}

/** A git repository per project, with the project's files as commits on `main` and names as tags. */
export class GitVersionAccess implements VersionAccess {
  private readonly fs: ReturnType<typeof gitFs>;

  constructor(
    private readonly storage: FileSystem,
    /** Where a project's repository is kept. */
    private readonly gitdirOf: (projectId: ProjectId) => string = (id) => joinPath('projects', id, '.git'),
  ) {
    this.fs = gitFs(storage);
  }

  async record(projectId: ProjectId, files: readonly VersionFile[], message: string, time: Timestamp, mergeOf?: string): Promise<string | undefined> {
    const git = await this.open(projectId);
    const gitdir = this.gitdirOf(projectId);
    const { fs } = this;
    const head = await this.head(git, gitdir);
    const blobs = [];
    for (const file of files) blobs.push({ parts: file.path.split('/'), oid: await this.writeBlob(git, gitdir, file, head) });
    const tree = await this.writeTree(git, gitdir, blobs);
    if (!mergeOf && head && (await git.readCommit({ fs, gitdir, oid: head })).commit.tree === tree) return undefined;
    const when = { name: 'CADence', email: 'cadence@localhost', timestamp: Math.floor(Date.parse(time) / 1000), timezoneOffset: 0 };
    const parent = [...(head ? [head] : []), ...(mergeOf ? [mergeOf] : [])];
    const oid = await git.writeCommit({ fs, gitdir, commit: { message, tree, parent, author: when, committer: when } });
    await git.writeRef({ fs, gitdir, ref: 'refs/heads/main', value: oid, force: true });
    return oid;
  }

  async versions(projectId: ProjectId, path?: string): Promise<Version[]> {
    const git = await loadGit();
    const gitdir = this.gitdirOf(projectId);
    const { fs } = this;
    if (!(await this.head(git, gitdir))) return [];
    const names = new Map<string, string[]>();
    for (const tag of await git.listTags({ fs, gitdir })) {
      const oid = await git.resolveRef({ fs, gitdir, ref: `refs/tags/${tag}` });
      names.set(oid, [...(names.get(oid) ?? []), tag]);
    }
    const log = await git.log({ fs, gitdir, ref: 'main', ...(path ? { filepath: path } : {}) });
    // What the remote had at the last fetch.
    const remoteHead = await git.resolveRef({ fs, gitdir, ref: 'refs/remotes/origin/main' }).catch(() => undefined);
    const shared = remoteHead ? new Set((await git.log({ fs, gitdir, ref: remoteHead })).map((entry) => entry.oid)) : undefined;
    return log.map((entry) => ({
      id: entry.oid,
      time: new Date(entry.commit.committer.timestamp * 1000).toISOString(),
      message: entry.commit.message.trim(),
      names: names.get(entry.oid) ?? [],
      ...(shared ? { shared: shared.has(entry.oid) } : {}),
    }));
  }

  async latest(projectId: ProjectId): Promise<string | undefined> {
    return this.head(await loadGit(), this.gitdirOf(projectId));
  }

  async read(projectId: ProjectId, version: string, path: string): Promise<string | undefined> {
    const bytes = await this.readBytes(projectId, version, path);
    return bytes && new TextDecoder().decode(bytes);
  }

  async readBytes(projectId: ProjectId, version: string, path: string): Promise<Uint8Array | undefined> {
    const git = await loadGit();
    try {
      return (await git.readBlob({ fs: this.fs, gitdir: this.gitdirOf(projectId), oid: version, filepath: path })).blob;
    } catch (error) {
      if ((error as { code?: string }).code === 'NotFoundError') return undefined;
      throw error;
    }
  }

  async files(projectId: ProjectId, version: string): Promise<string[]> {
    const git = await loadGit();
    return git.listFiles({ fs: this.fs, gitdir: this.gitdirOf(projectId), ref: version });
  }

  async commonVersion(projectId: ProjectId, a: string, b: string): Promise<string | undefined> {
    const git = await loadGit();
    const [base] = (await git.findMergeBase({ fs: this.fs, gitdir: this.gitdirOf(projectId), oids: [a, b] })) as string[];
    return base;
  }

  async advance(projectId: ProjectId, version: string): Promise<void> {
    const git = await this.open(projectId);
    await git.writeRef({ fs: this.fs, gitdir: this.gitdirOf(projectId), ref: 'refs/heads/main', value: version, force: true });
  }

  async name(projectId: ProjectId, version: string, name: string): Promise<void> {
    const git = await loadGit();
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith('.') || name.endsWith('.') || name.includes('..')) throw new InvalidVersionNameError(name);
    await git.tag({ fs: this.fs, gitdir: this.gitdirOf(projectId), ref: name, object: version, force: true });
  }

  async unname(projectId: ProjectId, name: string): Promise<void> {
    const git = await loadGit();
    await git.deleteTag({ fs: this.fs, gitdir: this.gitdirOf(projectId), ref: name });
  }

  async discard(projectId: ProjectId): Promise<void> {
    await this.storage.remove(this.gitdirOf(projectId));
  }

  async exportHistory(projectId: ProjectId): Promise<HistoryFile[]> {
    const files: HistoryFile[] = [];
    const walk = async (folder: string, prefix: string): Promise<void> => {
      for (const name of await this.storage.list(folder)) {
        const path = joinPath(folder, name);
        if (await this.storage.isDirectory(path)) await walk(path, `${prefix}${name}/`);
        else files.push({ path: `${prefix}${name}`, bytes: await this.storage.readBytes(path) });
      }
    };
    await walk(this.gitdirOf(projectId), '');
    return files;
  }

  async importHistory(projectId: ProjectId, files: readonly HistoryFile[]): Promise<void> {
    const gitdir = this.gitdirOf(projectId);
    await this.storage.remove(gitdir);
    for (const file of files) {
      if (file.path.split('/').some((part) => part === '..' || part === '')) continue;
      await this.storage.writeBytes(joinPath(gitdir, file.path), file.bytes);
    }
  }

  async fetch(projectId: ProjectId, remote: ProjectRemote, credentials?: RemoteCredentials): Promise<string | undefined> {
    const git = await this.open(projectId);
    const http = await loadHttp();
    try {
      // An empty remote has nothing to fetch.
      const refs = await git.listServerRefs({ http, ...this.remoteOptions(remote, credentials), prefix: 'refs/heads/main' });
      if (!refs.some((r) => r.ref === 'refs/heads/main')) return undefined;
      const { fs } = this;
      const gitdir = this.gitdirOf(projectId);
      // Fetching needs a remote with a refspec in the repository's config; the URL is the one given now.
      await git.setConfig({ fs, gitdir, path: 'remote.origin.url', value: remote.url });
      await git.setConfig({ fs, gitdir, path: 'remote.origin.fetch', value: '+refs/heads/main:refs/remotes/origin/main' });
      const fetched = await git.fetch({ fs, http, gitdir, ...this.remoteOptions(remote, credentials), remote: 'origin', ref: 'main', singleBranch: true, tags: false });
      return fetched.fetchHead ?? undefined;
    } catch (error) {
      throw remoteError(error, remote.url);
    }
  }

  async push(projectId: ProjectId, remote: ProjectRemote, credentials?: RemoteCredentials): Promise<void> {
    const git = await this.open(projectId);
    let result: { ok: boolean; error: string | null };
    try {
      result = await git.push({ fs: this.fs, http: await loadHttp(), gitdir: this.gitdirOf(projectId), ...this.remoteOptions(remote, credentials), ref: 'main', remoteRef: 'main' });
    } catch (error) {
      throw remoteError(error, remote.url);
    }
    if (!result.ok) throw new RemoteError('rejected', `${remote.url} did not take the versions: ${result.error ?? 'no reason given'}.`);
  }

  async syncNames(projectId: ProjectId, remote: ProjectRemote, credentials?: RemoteCredentials): Promise<string[]> {
    const git = await this.open(projectId);
    const gitdir = this.gitdirOf(projectId);
    const { fs } = this;
    const http = await loadHttp();
    try {
      const theirs = new Map(
        (await git.listServerRefs({ http, ...this.remoteOptions(remote, credentials), prefix: 'refs/tags/' }))
          .filter((r) => !r.ref.endsWith('^{}'))
          .map((r) => [r.ref.slice('refs/tags/'.length), r.oid]),
      );
      const conflicts: string[] = [];
      for (const [name, oid] of theirs) {
        const ours = await git.resolveRef({ fs, gitdir, ref: `refs/tags/${name}` }).catch(() => undefined);
        if (ours === undefined) {
          // Only versions we have can be named here.
          const known = await git.readCommit({ fs, gitdir, oid }).then(() => true, () => false);
          if (known) await git.writeRef({ fs, gitdir, ref: `refs/tags/${name}`, value: oid });
        } else if (ours !== oid) conflicts.push(name);
      }
      for (const name of await git.listTags({ fs, gitdir })) {
        if (theirs.has(name)) continue;
        await git.push({ fs, http, gitdir, ...this.remoteOptions(remote, credentials), ref: `refs/tags/${name}`, remoteRef: `refs/tags/${name}` });
      }
      return conflicts.sort();
    } catch (error) {
      throw remoteError(error, remote.url);
    }
  }

  private remoteOptions(remote: ProjectRemote, credentials?: RemoteCredentials) {
    return {
      url: remote.url,
      ...(remote.corsProxy ? { corsProxy: remote.corsProxy } : {}),
      // Given only when the remote asks for a sign-in; kept nowhere.
      ...(credentials ? { onAuth: () => ({ username: credentials.username, password: credentials.password }) } : {}),
    };
  }

  /** isomorphic-git, with the project's repository made when it has none yet. */
  private async open(projectId: ProjectId): Promise<Git> {
    const git = await loadGit();
    const gitdir = this.gitdirOf(projectId);
    if (!(await this.storage.exists(joinPath(gitdir, 'HEAD')))) await git.init({ fs: this.fs, gitdir, bare: true, defaultBranch: 'main' });
    return git;
  }

  private async head(git: Git, gitdir: string): Promise<string | undefined> {
    try {
      return await git.resolveRef({ fs: this.fs, gitdir, ref: 'refs/heads/main' });
    } catch {
      return undefined;
    }
  }

  /** Writes a file's blob; a file that never changes is taken from the latest version when it has it. */
  private async writeBlob(git: Git, gitdir: string, file: VersionFile, head: string | undefined): Promise<string> {
    const { fs } = this;
    if ('text' in file) return git.writeBlob({ fs, gitdir, blob: new TextEncoder().encode(file.text) });
    if (head) {
      const slash = file.path.lastIndexOf('/');
      try {
        const { tree } = await git.readTree({ fs, gitdir, oid: head, ...(slash > 0 ? { filepath: file.path.slice(0, slash) } : {}) });
        const kept = tree.find((entry) => entry.path === file.path.slice(slash + 1));
        if (kept) return kept.oid;
      } catch (error) {
        if ((error as { code?: string }).code !== 'NotFoundError') throw error;
      }
    }
    return git.writeBlob({ fs, gitdir, blob: await file.bytes() });
  }

  /** Writes the trees of the blobs (one tree per folder); returns the root tree's id. */
  private async writeTree(git: Git, gitdir: string, files: readonly { parts: readonly string[]; oid: string }[]): Promise<string> {
    const folders = new Map<string, { parts: readonly string[]; oid: string }[]>();
    const entries: { mode: string; path: string; oid: string; type: 'blob' | 'tree' }[] = [];
    for (const file of files) {
      const [first, ...rest] = file.parts as [string, ...string[]];
      if (rest.length) folders.set(first, [...(folders.get(first) ?? []), { parts: rest, oid: file.oid }]);
      else entries.push({ mode: '100644', path: first, oid: file.oid, type: 'blob' });
    }
    for (const [name, inside] of folders) entries.push({ mode: '040000', path: name, oid: await this.writeTree(git, gitdir, inside), type: 'tree' });
    return git.writeTree({ fs: this.fs, gitdir, tree: entries });
  }
}
