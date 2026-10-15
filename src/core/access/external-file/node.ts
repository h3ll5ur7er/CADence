import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { DeliveryOutcome, ExternalFileAccess, OutgoingFile } from './index';

/** Node: writes exported files into a folder (or to a path chosen for the next one) and remembers where. */
export class FolderDeliveryAccess implements ExternalFileAccess {
  /** Paths of the files written, oldest first. */
  readonly delivered: string[] = [];
  private next: string | undefined;

  constructor(private readonly folder: string) {}

  /** Where the next file goes, instead of the folder under its own name. */
  deliverNextTo(path: string): void {
    this.next = resolve(path);
  }

  async deliver(file: OutgoingFile): Promise<DeliveryOutcome> {
    const path = this.next ?? resolve(join(this.folder, file.name));
    this.next = undefined;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.bytes);
    this.delivered.push(path);
    return 'delivered';
  }
}
