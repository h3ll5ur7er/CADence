import { Injectable, inject, signal } from '@angular/core';
import type { DocumentId } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';

/** Keeps the picture of the document being edited; provided per editor, which says which one that is. */
@Injectable()
export class ThumbnailSaver {
  private readonly projects = inject(PROJECT_MANAGER);
  readonly document = signal<DocumentId | undefined>(undefined);
  /** Bumped after every saved picture, so lists showing pictures reload them. */
  readonly saved = signal(0);

  save(png: Uint8Array): void {
    const id = this.document();
    if (id) void this.projects.saveThumbnail(id, png).then(() => this.saved.update((n) => n + 1));
  }
}
