/** A file leaving the app: an export the user saves somewhere. */
export interface OutgoingFile {
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export type DeliveryOutcome = 'delivered' | 'cancelled';

/**
 * Hands files to the user: a download in the browser, a native save dialog on desktop.
 * (Choosing files to import needs a user gesture, so the client does that; see the Components page.)
 */
export interface ExternalFileAccess {
  deliver(file: OutgoingFile): Promise<DeliveryOutcome>;
}

/** Browser: triggers a download through a temporary object URL. */
export class BrowserDownloadAccess implements ExternalFileAccess {
  async deliver(file: OutgoingFile): Promise<DeliveryOutcome> {
    const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mediaType }));
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return 'delivered';
  }
}

/** Keeps delivered files in memory; for tests and demos. */
export class InMemoryExternalFileAccess implements ExternalFileAccess {
  readonly delivered: OutgoingFile[] = [];

  async deliver(file: OutgoingFile): Promise<DeliveryOutcome> {
    this.delivered.push(file);
    return 'delivered';
  }
}
