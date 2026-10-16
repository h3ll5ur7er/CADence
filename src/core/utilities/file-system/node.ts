import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FileSystem } from './index';

/** FileSystem over a real directory (Node): project folders for the command line, and contract tests of the desktop storage. */
export class NodeFileSystem implements FileSystem {
  private written = 0;

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

  writeText(path: string, text: string): Promise<void> {
    return this.replace(path, text);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(path)));
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.replace(path, bytes);
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

  /**
   * Writes to a temporary name next to the file, then puts it in the file's place, so a process that
   * ends meanwhile leaves the old file or the new one, never one cut short (CAD-119). Windows refuses
   * the rename for a moment while another program (a virus scanner) has the file open: tried again.
   */
  private async replace(path: string, data: string | Uint8Array): Promise<void> {
    const target = this.resolve(path);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}-${++this.written}.tmp`;
    await writeFile(temporary, data);
    for (let attempt = 1; ; attempt++) {
      try {
        return await rename(temporary, target);
      } catch (error) {
        if (attempt >= 10 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
          await rm(temporary, { force: true });
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
      }
    }
  }

  private resolve(path: string): string {
    return join(this.root, ...path.split('/'));
  }
}
