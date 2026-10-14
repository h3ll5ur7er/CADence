import { type AssetAccess, IndexedDbAssetAccess, InMemoryAssetAccess } from '@core/access/asset';
import { type DocumentAccess, IndexedDbDocumentAccess, InMemoryDocumentAccess } from '@core/access/document';
import { IndexedDbProjectAccess, InMemoryProjectAccess, type ProjectAccess } from '@core/access/project';
import type { DomainEvents } from '@core/contracts';
import { createProjectManager, type ProjectManager } from '@core/managers/project';
import { systemClock } from '@core/utilities/clock';
import { newId } from '@core/utilities/identity';
import { EventBus } from '@core/utilities/messaging';

/** Everything a client may use: the managers. */
export interface Core {
  readonly projectManager: ProjectManager;
}

/** The storage a host provides; the only thing that differs between browser and desktop. */
export interface Storage {
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
}

export function createCore(storage: Storage): Core {
  const events = new EventBus<DomainEvents>();
  return {
    projectManager: createProjectManager({ ...storage, events, clock: systemClock, newId }),
  };
}

/** Composition root for the browser: IndexedDB storage. */
export function createBrowserCore(): Core {
  return createCore({
    projects: new IndexedDbProjectAccess(),
    documents: new IndexedDbDocumentAccess(),
    assets: new IndexedDbAssetAccess(),
  });
}

/** Composition root without persistence, for component tests and demos. */
export function createInMemoryCore(): Core {
  return createCore({
    projects: new InMemoryProjectAccess(),
    documents: new InMemoryDocumentAccess(),
    assets: new InMemoryAssetAccess(),
  });
}
