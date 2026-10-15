import { type AssetAccess, FileSystemAssetAccess, IndexedDbAssetAccess, InMemoryAssetAccess } from '@core/access/asset';
import {
  type DocumentAccess,
  FileSystemDocumentAccess,
  IndexedDbDocumentAccess,
  InMemoryDocumentAccess,
} from '@core/access/document';
import {
  BrowserDownloadAccess,
  type ExternalFileAccess,
  InMemoryExternalFileAccess,
} from '@core/access/external-file';
import {
  FileSystemProjectAccess,
  IndexedDbProjectAccess,
  InMemoryProjectAccess,
  type ProjectAccess,
} from '@core/access/project';
import type { DomainEvents } from '@core/contracts';
import { createInterchangeEngine } from '@core/engines/interchange';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { createDesignManager, type DesignManager } from '@core/managers/design';
import { createProjectManager, type ProjectManager } from '@core/managers/project';
import { systemClock } from '@core/utilities/clock';
import type { FileSystem } from '@core/utilities/file-system';
import { newId } from '@core/utilities/identity';
import { EventBus } from '@core/utilities/messaging';

/** Everything a client may use: the managers, plus where projects are kept. */
export interface Core {
  readonly projectManager: ProjectManager;
  readonly designManager: DesignManager;
  readonly storage: StorageKind;
}

export type StorageKind = 'browser' | 'project-folders' | 'memory';

/** What a host provides; the only things that differ between browser, desktop and tests. */
export interface Host {
  readonly kind: StorageKind;
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly externalFiles: ExternalFileAccess;
  /** Where the browser loads the constraint solver from; Node finds it on its own. */
  readonly solverWasmUrl?: string;
}

export interface HostOptions {
  readonly solverWasmUrl?: string;
}

export function createCore(host: Host): Core {
  const events = new EventBus<DomainEvents>();
  const { projects, documents, assets, externalFiles } = host;
  return {
    projectManager: createProjectManager({ projects, documents, assets, events, clock: systemClock, newId }),
    designManager: createDesignManager({
      documents,
      externalFiles,
      sketches: createSketchEngine(host.solverWasmUrl ? { wasmUrl: host.solverWasmUrl } : {}),
      parameters: createParameterEngine(),
      interchange: createInterchangeEngine(),
      clock: systemClock,
    }),
    storage: host.kind,
  };
}

/** Composition root for the browser: IndexedDB storage, exports as downloads. */
export function createBrowserCore(options: HostOptions = {}): Core {
  return createCore({
    kind: 'browser',
    projects: new IndexedDbProjectAccess(),
    documents: new IndexedDbDocumentAccess(),
    assets: new IndexedDbAssetAccess(),
    externalFiles: new BrowserDownloadAccess(),
    ...options,
  });
}

/** Composition root for the desktop: project folders and file delivery the host provides. */
export function createDesktopCore(
  fileSystem: FileSystem,
  externalFiles: ExternalFileAccess,
  options: HostOptions = {},
): Core {
  return createCore({
    kind: 'project-folders',
    projects: new FileSystemProjectAccess(fileSystem),
    documents: new FileSystemDocumentAccess(fileSystem),
    assets: new FileSystemAssetAccess(fileSystem),
    externalFiles,
    ...options,
  });
}

/** Composition root without persistence, for component tests and demos. */
export function createInMemoryCore(options: HostOptions = {}): Core {
  return createCore({
    kind: 'memory',
    projects: new InMemoryProjectAccess(),
    documents: new InMemoryDocumentAccess(),
    assets: new InMemoryAssetAccess(),
    externalFiles: new InMemoryExternalFileAccess(),
    ...options,
  });
}
