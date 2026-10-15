import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { createBrowserCore, createDesktopCore } from '@core/composition';
import { isTauri } from '@tauri-apps/api/core';
import { routes } from './app.routes';
import { provideCore } from './core.providers';
import { TauriFileSystem } from './platform/tauri-file-system';

/** The host decides where projects live: project folders on desktop, IndexedDB in the browser. */
const core = isTauri() ? createDesktopCore(new TauriFileSystem()) : createBrowserCore();

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideCore(core),
  ],
};
