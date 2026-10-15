import { KeyValueDatabase } from '../indexed-db';
import type { FileSystem } from './index';

interface Entry {
  readonly path: string;
  readonly parent: string;
  readonly bytes?: Uint8Array;
}

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
const store = 'entries';

/**
 * A FileSystem in an IndexedDB database, for what the browser keeps as files (the projects' version
 * repositories). Entries without bytes are directories; `parent` lists a directory's entries.
 */
export class IndexedDbFileSystem implements FileSystem {
  private readonly db: KeyValueDatabase;

  constructor(databaseName = 'cadence-files', factory?: IDBFactory) {
    this.db = new KeyValueDatabase(databaseName, [{ name: store, keyPath: 'path', indexes: [{ name: 'parent', keyPath: 'parent' }] }], factory);
  }

  async exists(path: string): Promise<boolean> {
    return path === '' || (await this.db.get<Entry>(store, path)) !== undefined;
  }

  async isDirectory(path: string): Promise<boolean> {
    if (path === '') return true;
    const entry = await this.db.get<Entry>(store, path);
    return entry !== undefined && entry.bytes === undefined;
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  writeText(path: string, text: string): Promise<void> {
    return this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const entry = await this.db.get<Entry>(store, path);
    if (!entry?.bytes) throw Object.assign(new Error(`No file ${path}`), { code: 'ENOENT' });
    return entry.bytes;
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.makeDirectory(parentOf(path));
    await this.db.put(store, { path, parent: parentOf(path), bytes: bytes.slice() } satisfies Entry);
  }

  async list(path: string): Promise<string[]> {
    const entries = await this.db.getAll<Entry>(store, { name: 'parent', value: path });
    return entries.map((e) => e.path.slice(path ? path.length + 1 : 0));
  }

  async makeDirectory(path: string): Promise<void> {
    const missing: string[] = [];
    for (let p = path; p && !(await this.exists(p)); p = parentOf(p)) missing.push(p);
    for (const p of missing.reverse()) await this.db.put(store, { path: p, parent: parentOf(p) } satisfies Entry);
  }

  async remove(path: string): Promise<void> {
    for (const name of await this.list(path)) await this.remove(path ? `${path}/${name}` : name);
    if (path) await this.db.delete(store, path);
  }
}
