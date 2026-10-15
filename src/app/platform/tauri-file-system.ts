import type { FileSystem } from '@core/utilities/file-system';
import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

const options = { baseDir: BaseDirectory.AppData };

const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));

/** FileSystem rooted in the app data folder, through Tauri's fs plugin (scope: capabilities/default.json). */
export class TauriFileSystem implements FileSystem {
  exists(path: string): Promise<boolean> {
    return exists(path, options);
  }

  readText(path: string): Promise<string> {
    return readTextFile(path, options);
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.makeDirectory(parentOf(path));
    await writeTextFile(path, text, options);
  }

  readBytes(path: string): Promise<Uint8Array> {
    return readFile(path, options);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.makeDirectory(parentOf(path));
    await writeFile(path, bytes, options);
  }

  async list(path: string): Promise<string[]> {
    if (!(await exists(path, options))) return [];
    return (await readDir(path, options)).map((entry) => entry.name);
  }

  async makeDirectory(path: string): Promise<void> {
    if (path) await mkdir(path, { ...options, recursive: true });
  }

  async remove(path: string): Promise<void> {
    if (await exists(path, options)) await remove(path, { ...options, recursive: true });
  }
}
