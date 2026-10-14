import { Injectable, signal } from '@angular/core';
import type { RendererBackend } from '../viewport/viewport-scene';

/** Status bar state shared by the editor shell and its modes; provided per editor. */
@Injectable()
export class EditorStatus {
  readonly renderer = signal<RendererBackend | undefined>(undefined);
}
