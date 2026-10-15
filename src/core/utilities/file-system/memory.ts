import type { FileSystem } from './index';

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** A FileSystem in memory: for tests and for the in-memory core. Directories exist once written into. */
export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>(['']);

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async isDirectory(path: string): Promise<boolean> {
    return this.directories.has(path);
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  writeText(path: string, text: string): Promise<void> {
    return this.writeBytes(path, new TextEncoder().encode(text));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw Object.assign(new Error(`No file ${path}`), { code: 'ENOENT' });
    return bytes.slice();
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.makeDirectory(parentOf(path));
    this.files.set(path, bytes.slice());
  }

  async list(path: string): Promise<string[]> {
    const prefix = path ? `${path}/` : '';
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.directories]) {
      if (key !== path && key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0] as string);
    }
    return [...names].filter(Boolean);
  }

  async makeDirectory(path: string): Promise<void> {
    for (let p = path; p; p = parentOf(p)) this.directories.add(p);
  }

  async remove(path: string): Promise<void> {
    const inside = (key: string) => key === path || key.startsWith(`${path}/`);
    for (const key of [...this.files.keys()]) if (inside(key)) this.files.delete(key);
    for (const key of [...this.directories]) if (inside(key) && key) this.directories.delete(key);
  }
}
