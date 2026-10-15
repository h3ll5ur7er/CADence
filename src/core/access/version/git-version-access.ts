import type { ProjectId, Timestamp } from '@core/contracts';
import type * as IsomorphicGit from 'isomorphic-git';
import { type FileSystem, joinPath } from '@core/utilities/file-system';
import { InvalidVersionNameError, type Version, type VersionAccess, type VersionFile } from './version-access';

type Git = typeof IsomorphicGit;

/** isomorphic-git, with the global Buffer it expects, loaded on first use. */
let loaded: Promise<Git> | undefined;
function loadGit(): Promise<Git> {
  loaded ??= (async () => {
    const { Buffer } = await import('buffer');
    (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
    return import('isomorphic-git');
  })();
  return loaded;
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
    private readonly files: FileSystem,
    /** Where a project's repository is kept. */
    private readonly gitdirOf: (projectId: ProjectId) => string = (id) => joinPath('projects', id, '.git'),
  ) {
    this.fs = gitFs(files);
  }

  async record(projectId: ProjectId, files: readonly VersionFile[], message: string, time: Timestamp): Promise<string | undefined> {
    const git = await loadGit();
    const gitdir = this.gitdirOf(projectId);
    const { fs } = this;
    if (!(await this.files.exists(joinPath(gitdir, 'HEAD')))) await git.init({ fs, gitdir, bare: true, defaultBranch: 'main' });
    const tree = await this.writeTree(git, gitdir, files.map((f) => ({ parts: f.path.split('/'), text: f.text })));
    const head = await this.head(git, gitdir);
    if (head && (await git.readCommit({ fs, gitdir, oid: head })).commit.tree === tree) return undefined;
    const when = { name: 'CADence', email: 'cadence@localhost', timestamp: Math.floor(Date.parse(time) / 1000), timezoneOffset: 0 };
    const oid = await git.writeCommit({ fs, gitdir, commit: { message, tree, parent: head ? [head] : [], author: when, committer: when } });
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
    return log.map((entry) => ({
      id: entry.oid,
      time: new Date(entry.commit.committer.timestamp * 1000).toISOString(),
      message: entry.commit.message.trim(),
      names: names.get(entry.oid) ?? [],
    }));
  }

  async read(projectId: ProjectId, version: string, path: string): Promise<string | undefined> {
    const git = await loadGit();
    try {
      const { blob } = await git.readBlob({ fs: this.fs, gitdir: this.gitdirOf(projectId), oid: version, filepath: path });
      return new TextDecoder().decode(blob);
    } catch (error) {
      if ((error as { code?: string }).code === 'NotFoundError') return undefined;
      throw error;
    }
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
    await this.files.remove(this.gitdirOf(projectId));
  }

  private async head(git: Git, gitdir: string): Promise<string | undefined> {
    try {
      return await git.resolveRef({ fs: this.fs, gitdir, ref: 'refs/heads/main' });
    } catch {
      return undefined;
    }
  }

  /** Writes the files as blobs and trees (one tree per folder); returns the root tree's id. */
  private async writeTree(git: Git, gitdir: string, files: readonly { parts: readonly string[]; text: string }[]): Promise<string> {
    const { fs } = this;
    const folders = new Map<string, { parts: readonly string[]; text: string }[]>();
    const entries: { mode: string; path: string; oid: string; type: 'blob' | 'tree' }[] = [];
    for (const file of files) {
      const [first, ...rest] = file.parts as [string, ...string[]];
      if (rest.length) folders.set(first, [...(folders.get(first) ?? []), { parts: rest, text: file.text }]);
      else entries.push({ mode: '100644', path: first, oid: await git.writeBlob({ fs, gitdir, blob: new TextEncoder().encode(file.text) }), type: 'blob' });
    }
    for (const [name, inside] of folders) entries.push({ mode: '040000', path: name, oid: await this.writeTree(git, gitdir, inside), type: 'tree' });
    return git.writeTree({ fs, gitdir, tree: entries });
  }
}
