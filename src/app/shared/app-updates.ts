import { DestroyRef, Injectable, InjectionToken, inject, type Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { merge } from 'rxjs';
import { filter } from 'rxjs/operators';

/** Reloads the page (replaced in tests). */
export const RELOAD = new InjectionToken<() => void>('Reload', { factory: () => () => location.reload() });

/** A newer version of CADence the user can switch to. */
export interface AvailableUpdate {
  readonly message: string;
  /** The button that switches to it. */
  readonly action: string;
}

/** Newer versions of CADence: the web app's service worker, or the desktop app's updater. */
export abstract class AppUpdates {
  abstract readonly available: Signal<AvailableUpdate | undefined>;
  abstract apply(): Promise<void>;
}

/**
 * The web app runs from its service worker's cache, also offline. When a newer version has been
 * downloaded in the background, it is ready after a reload.
 */
@Injectable()
export class ServiceWorkerUpdates extends AppUpdates {
  private readonly ready = signal<AvailableUpdate | undefined>(undefined);
  readonly available = this.ready.asReadonly();
  private readonly reload = inject(RELOAD);

  constructor() {
    super();
    const updates = inject(SwUpdate);
    if (!updates.isEnabled) return;
    merge(updates.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')), updates.unrecoverable)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.ready.set({ message: 'A new version of CADence is ready.', action: 'Reload' }));
  }

  async apply(): Promise<void> {
    this.reload();
  }
}

/** What the desktop updater offers (src/app/platform/tauri-updater.ts). */
export interface DesktopUpdater {
  check(): Promise<string | undefined>;
  install(): Promise<void>;
}

/** The desktop app asks for a newer release once at start; installing it restarts the app. */
export class DesktopUpdates extends AppUpdates {
  private readonly found = signal<AvailableUpdate | undefined>(undefined);
  readonly available = this.found.asReadonly();

  constructor(private readonly updater: DesktopUpdater) {
    super();
    void updater.check().then((version) => {
      if (version) this.found.set({ message: `CADence ${version} is available.`, action: 'Install and restart' });
    });
  }

  apply(): Promise<void> {
    return this.updater.install();
  }
}
