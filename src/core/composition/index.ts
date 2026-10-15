import { type AssetAccess, FileSystemAssetAccess, IndexedDbAssetAccess, InMemoryAssetAccess } from '@core/access/asset';
import {
  type DocumentAccess,
  FileSystemDocumentAccess,
  IndexedDbDocumentAccess,
  InMemoryDocumentAccess,
} from '@core/access/document';
import {
  FileSystemProjectAccess,
  IndexedDbProjectAccess,
  InMemoryProjectAccess,
  type ProjectAccess,
} from '@core/access/project';
import type { DomainEvents } from '@core/contracts';
import { createProjectManager, type ProjectManager } from '@core/managers/project';
import { systemClock } from '@core/utilities/clock';
import type { FileSystem } from '@core/utilities/file-system';
import { newId } from '@core/utilities/identity';
import { EventBus } from '@core/utilities/messaging';

/** Everything a client may use: the managers, plus where projects are kept. */
export interface Core {
  readonly projectManager: ProjectManager;
  readonly storage: StorageKind;
}

export type StorageKind = 'browser' | 'project-folders' | 'memory';

/** The storage a host provides; the only thing that differs between browser and desktop. */
export interface Storage {
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
}

export function createCore(storage: Storage, kind: StorageKind): Core {
  const events = new EventBus<DomainEvents>();
  return {
    projectManager: createProjectManager({ ...storage, events, clock: systemClock, newId }),
    storage: kind,
  };
}

/** Composition root for the browser: IndexedDB storage. */
export function createBrowserCore(): Core {
  return createCore({
    projects: new IndexedDbProjectAccess(),
    documents: new IndexedDbDocumentAccess(),
    assets: new IndexedDbAssetAccess(),
  }, 'browser');
}

/** Composition root for the desktop: project folders in a file system the host provides. */
export function createDesktopCore(fileSystem: FileSystem): Core {
  return createCore({
    projects: new FileSystemProjectAccess(fileSystem),
    documents: new FileSystemDocumentAccess(fileSystem),
    assets: new FileSystemAssetAccess(fileSystem),
  }, 'project-folders');
}

/** Composition root without persistence, for component tests and demos. */
export function createInMemoryCore(): Core {
  return createCore({
    projects: new InMemoryProjectAccess(),
    documents: new InMemoryDocumentAccess(),
    assets: new InMemoryAssetAccess(),
  }, 'memory');
}
