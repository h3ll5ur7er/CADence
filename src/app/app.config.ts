import { type ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { createBrowserCore, createDesktopCore } from '@core/composition';
import { fontFiles } from '@core/utilities/text';
import { isTauri } from '@tauri-apps/api/core';
import { routes } from './app.routes';
import { provideCore } from './core.providers';
import { TauriFileDelivery } from './platform/tauri-file-delivery';
import { TauriFileSystem } from './platform/tauri-file-system';
import { openWebLinksInBrowser } from './platform/tauri-links';
import { tauriAgentCli } from './platform/tauri-agent-cli';
import { tauriOpenedFiles } from './platform/tauri-opened-files';
import { tauriSystemFonts } from './platform/tauri-system-fonts';
import { TauriUpdater } from './platform/tauri-updater';
import { AppUpdates, DesktopUpdates, ServiceWorkerUpdates } from './shared/app-updates';
import { AGENT_CLI } from './shared/agent-cli';
import { OPENED_FILES } from './shared/file-opener';
import { SYSTEM_FONTS } from './shared/fonts';

/**
 * The sketch solver's WebAssembly is copied to /wasm by the build (angular.json assets); the geometry
 * kernel runs in its own worker (docs/Architecture.md#deployment-and-threads).
 */
const options = {
  solverWasmUrl: new URL('wasm/planegcs.wasm', document.baseURI).href,
  fontUrls: { regular: new URL(`fonts/${fontFiles.regular}`, document.baseURI).href, bold: new URL(`fonts/${fontFiles.bold}`, document.baseURI).href },
  geometry: new Worker(new URL('../workers/geometry.worker', import.meta.url), { type: 'module' }),
  // Drawing views are drawn exactly in a worker of their own, which is stopped when one takes too long (CAD-125).
  views: () => new Worker(new URL('../workers/views.worker', import.meta.url), { type: 'module' }),
  // Other tabs and windows hear about saved components, so their open assemblies update (CAD-82).
  ...(typeof BroadcastChannel === 'undefined' ? {} : { channel: new BroadcastChannel('cadence-events') }),
};

/** The host decides where projects live and how exports are saved. */
const desktop = isTauri();
const core = desktop
  ? createDesktopCore(new TauriFileSystem(), new TauriFileDelivery(), options)
  : createBrowserCore(options);
if (desktop) openWebLinksInBrowser();

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideCore(core),
    // The web app works offline from its cache (ngsw-config.json); the desktop app is installed and needs none.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() && !desktop, registrationStrategy: 'registerWhenStable:5000' }),
    // Newer versions: the service worker's on the web, signed GitHub releases on the desktop.
    desktop ? { provide: AppUpdates, useValue: new DesktopUpdates(new TauriUpdater()) } : { provide: AppUpdates, useClass: ServiceWorkerUpdates },
    ...(desktop ? [{ provide: OPENED_FILES, useValue: tauriOpenedFiles }, { provide: SYSTEM_FONTS, useValue: tauriSystemFonts }, { provide: AGENT_CLI, useValue: tauriAgentCli }] : []),
  ],
};
