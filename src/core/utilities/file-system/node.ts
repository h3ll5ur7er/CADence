import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileSystem } from './index';

/** FileSystem over a real directory (Node): project folders for the command line, and contract tests of the desktop storage. */
export class NodeFileSystem implements FileSystem {
  constructor(private readonly root: string) {}

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }

  async isDirectory(path: string): Promise<boolean> {
    return existsSync(this.resolve(path)) && (await stat(this.resolve(path))).isDirectory();
  }

  readText(path: string): Promise<string> {
    return readFile(this.resolve(path), 'utf8');
  }

  async writeText(path: string, text: string): Promise<void> {
    await mkdir(dirname(this.resolve(path)), { recursive: true });
    await writeFile(this.resolve(path), text, 'utf8');
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(path)));
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(this.resolve(path)), { recursive: true });
    await writeFile(this.resolve(path), bytes);
  }

  async list(path: string): Promise<string[]> {
    return existsSync(this.resolve(path)) ? readdir(this.resolve(path)) : [];
  }

  async makeDirectory(path: string): Promise<void> {
    await mkdir(this.resolve(path), { recursive: true });
  }

  remove(path: string): Promise<void> {
    return rm(this.resolve(path), { recursive: true, force: true });
  }

  private resolve(path: string): string {
    return join(this.root, ...path.split('/'));
  }
}
