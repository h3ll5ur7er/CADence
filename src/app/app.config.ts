import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { createBrowserCore, createDesktopCore } from '@core/composition';
import { isTauri } from '@tauri-apps/api/core';
import { routes } from './app.routes';
import { provideCore } from './core.providers';
import { TauriFileDelivery } from './platform/tauri-file-delivery';
import { TauriFileSystem } from './platform/tauri-file-system';

/** The solver's WebAssembly is copied to /wasm by the build (angular.json assets). */
const options = { solverWasmUrl: new URL('wasm/planegcs.wasm', document.baseURI).href };

/** The host decides where projects live and how exports are saved. */
const core = isTauri()
  ? createDesktopCore(new TauriFileSystem(), new TauriFileDelivery(), options)
  : createBrowserCore(options);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideCore(core),
  ],
};
