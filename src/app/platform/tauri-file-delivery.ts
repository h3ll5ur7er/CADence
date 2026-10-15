import type { DeliveryOutcome, ExternalFileAccess, OutgoingFile } from '@core/access/external-file';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/** Desktop: a native save dialog, then the bytes are written to the chosen path. */
export class TauriFileDelivery implements ExternalFileAccess {
  async deliver(file: OutgoingFile): Promise<DeliveryOutcome> {
    const extension = file.name.slice(file.name.lastIndexOf('.') + 1);
    const path = await save({
      defaultPath: file.name,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return 'cancelled';
    await writeFile(path, file.bytes);
    return 'delivered';
  }
}
