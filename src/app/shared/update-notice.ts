import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AppUpdates } from './app-updates';

/** Offers to switch to a newer version of CADence when one is ready (web) or available (desktop). */
@Component({
  selector: 'cad-update-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updates.available(); as update) {
      <div class="notice" role="status">
        <span>{{ update.message }}</span>
        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="apply()">{{ busy() ? 'Installing…' : update.action }}</button>
      </div>
    }
  `,
  styles: `
    .notice {
      position: fixed;
      right: var(--space-4);
      bottom: var(--space-4);
      z-index: 100;
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-raised);
      box-shadow: var(--shadow);
    }
  `,
})
export class UpdateNotice {
  protected readonly updates = inject(AppUpdates);
  protected readonly busy = signal(false);

  protected async apply(): Promise<void> {
    this.busy.set(true);
    try {
      await this.updates.apply();
    } finally {
      this.busy.set(false);
    }
  }
}
