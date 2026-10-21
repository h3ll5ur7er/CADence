import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import type { DocumentId } from '@core/contracts';
import type { ProjectManager } from '@core/managers/project';

/**
 * Follows the open document when it changes elsewhere: another tab or window, or another program
 * such as an agent's MCP server writing the desktop app's project folders (CAD-150). The editor reads
 * it again, unless the user is in the middle of an input: then it asks first (`pending`).
 */
export class ChangedElsewhere {
  /** It changed while the user was in the middle of something: reload, or keep editing. */
  readonly pending = signal(false);
  private stop: (() => void) | undefined;

  constructor(private readonly projects: ProjectManager) {}

  /**
   * Starts following a document just opened: `shown` is the change the editor shows, `busy` whether
   * the user is in the middle of an input, `reload` opens it again.
   */
  follow(documentId: DocumentId, shown: () => string | undefined, busy: () => boolean, reload: () => Promise<void>): void {
    this.close();
    this.stop = this.projects.watch((change) => {
      if (change.kind !== 'document' || change.documentId !== documentId || change.gone) return;
      void this.projects.findDocument(documentId).then((now) => {
        // Its own saves are what it shows already.
        if (!now || now.modifiedAt === shown()) return;
        if (busy()) this.pending.set(true);
        else void reload();
      });
    });
  }

  close(): void {
    this.stop?.();
    this.stop = undefined;
    this.pending.set(false);
  }
}

/** Says that the open document changed elsewhere while the user was editing it, with what to do. */
@Component({
  selector: 'cad-changed-elsewhere',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown()) {
      <div class="notice" role="alert">
        <span>Another program changed this document.</span>
        <button type="button" class="btn btn-primary" (click)="reload.emit()">Load its changes</button>
        <button type="button" class="btn" (click)="keep.emit()">Keep editing</button>
      </div>
    }
  `,
  styles: `
    .notice {
      position: absolute;
      top: var(--space-3);
      left: 50%;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--warning, var(--border));
      border-radius: var(--radius, 6px);
      background: var(--surface-1);
      box-shadow: 0 4px 16px rgb(0 0 0 / 0.18);
      font-size: 13px;
      transform: translateX(-50%);
    }
  `,
})
export class ChangedElsewhereNotice {
  readonly shown = input(false);
  readonly reload = output();
  readonly keep = output();
}
