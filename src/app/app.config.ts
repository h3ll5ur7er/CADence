import { type ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { createBrowserCore, createDesktopCore } from '@core/composition';
import { isTauri } from '@tauri-apps/api/core';
import { routes } from './app.routes';
import { provideCore } from './core.providers';
import { TauriFileDelivery } from './platform/tauri-file-delivery';
import { TauriFileSystem } from './platform/tauri-file-system';

/**
 * The sketch solver's WebAssembly is copied to /wasm by the build (angular.json assets); the geometry
 * kernel runs in its own worker (docs/Architecture.md#deployment-and-threads).
 */
const options = {
  solverWasmUrl: new URL('wasm/planegcs.wasm', document.baseURI).href,
  geometry: new Worker(new URL('../workers/geometry.worker', import.meta.url), { type: 'module' }),
};

/** The host decides where projects live and how exports are saved. */
const desktop = isTauri();
const core = desktop
  ? createDesktopCore(new TauriFileSystem(), new TauriFileDelivery(), options)
  : createBrowserCore(options);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideCore(core),
    // The web app works offline from its cache (ngsw-config.json); the desktop app is installed and needs none.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() && !desktop, registrationStrategy: 'registerWhenStable:5000' }),
  ],
};
