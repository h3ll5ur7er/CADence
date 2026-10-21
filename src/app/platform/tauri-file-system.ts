import type { FileSystem } from '@core/utilities/file-system';
import { contentHash } from '@core/utilities/identity';
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  rename,
  stat,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

const options = { baseDir: BaseDirectory.AppData };

/** What `own` keeps for a path this app removed. */
const removed = 'removed';

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** FileSystem rooted in the app data folder, through Tauri's fs plugin (scope: capabilities/default.json). */
export class TauriFileSystem implements FileSystem {
  /** What this app last wrote at a path (a hash of the text), or that it removed it: changes not to report (CAD-150). */
  private readonly own = new Map<string, string>();

  exists(path: string): Promise<boolean> {
    return exists(path, options);
  }

  async isDirectory(path: string): Promise<boolean> {
    return (await exists(path, options)) && (await stat(path, options)).isDirectory;
  }

  readText(path: string): Promise<string> {
    return readTextFile(path, options);
  }

  writeText(path: string, text: string): Promise<void> {
    this.own.set(path, contentHash(text));
    return this.replace(path, (temporary) => writeTextFile(temporary, text, options));
  }

  /** Of these paths, those another process changed: their text is not what this app wrote last, or they went without it removing them. */
  async notWrittenHere(paths: readonly string[]): Promise<string[]> {
    const changed: string[] = [];
    for (const path of new Set(paths)) {
      const there = await exists(path, options).catch(() => false);
      const now = there ? contentHash(await readTextFile(path, options).catch(() => '')) : removed;
      if (this.own.get(path) !== now) changed.push(path);
    }
    return changed;
  }

  readBytes(path: string): Promise<Uint8Array> {
    return readFile(path, options);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.replace(path, (temporary) => writeFile(temporary, bytes, options));
  }

  async list(path: string): Promise<string[]> {
    if (!(await exists(path, options))) return [];
    return (await readDir(path, options)).map((entry) => entry.name);
  }

  async makeDirectory(path: string): Promise<void> {
    if (path) await mkdir(path, { ...options, recursive: true });
  }

  async remove(path: string): Promise<void> {
    for (const known of this.own.keys()) if (known === path || known.startsWith(`${path}/`)) this.own.set(known, removed);
    if (await exists(path, options)) await remove(path, { ...options, recursive: true });
  }

  /** Writes to a temporary name, then renames it into place: the app closing meanwhile never leaves a file cut short (CAD-119). */
  private async replace(path: string, write: (temporary: string) => Promise<void>): Promise<void> {
    await this.makeDirectory(parentOf(path));
    // Random, since the app's windows write into the same folders.
    const temporary = `${path}.${Math.random().toString(36).slice(2)}.tmp`;
    await write(temporary);
    await rename(temporary, path, { oldPathBaseDir: options.baseDir, newPathBaseDir: options.baseDir });
  }
}
