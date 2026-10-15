import { ChangeDetectionStrategy, Component, InjectionToken, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { merge } from 'rxjs';
import { filter } from 'rxjs/operators';

/** Reloads the page (replaced in tests). */
export const RELOAD = new InjectionToken<() => void>('Reload', { factory: () => () => location.reload() });

/**
 * The web app runs from its service worker's cache, also offline. When a newer version has been
 * downloaded in the background, this offers to switch to it; the desktop app has no service worker.
 */
@Component({
  selector: 'cad-update-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ready()) {
      <div class="notice" role="status">
        <span>A new version of CADence is ready.</span>
        <button type="button" class="btn btn-primary" (click)="reload()">Reload</button>
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
  protected readonly ready = signal(false);
  protected readonly reload = inject(RELOAD);

  constructor() {
    const updates = inject(SwUpdate);
    if (!updates.isEnabled) return;
    merge(updates.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')), updates.unrecoverable)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.ready.set(true));
  }
}
