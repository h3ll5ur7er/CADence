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
import type { InterchangeEngine } from '@core/engines/interchange';
import type { ModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { createDesignManager, type DesignManager } from '@core/managers/design';
import { createProjectManager, type ProjectManager } from '@core/managers/project';
import { systemClock } from '@core/utilities/clock';
import type { FileSystem } from '@core/utilities/file-system';
import { newId } from '@core/utilities/identity';
import { EventBus, type Port, remote } from '@core/utilities/messaging';

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
  /** Port to the geometry worker; without it the geometry kernel runs in this thread (Node, tests). */
  readonly geometry?: Port;
}

export interface HostOptions {
  readonly solverWasmUrl?: string;
  readonly geometry?: Port;
}

interface Geometry {
  readonly modeling: ModelingEngine;
  readonly interchange: InterchangeEngine;
}

/**
 * The kernel-bound engines in this thread (Node, tests), sharing one shape store. Loaded on first use,
 * so browser bundles, which use the worker, never include the kernel.
 */
function localGeometry(): Geometry {
  const engines = (async (): Promise<Geometry> => {
    const [{ createShapeAccess }, { createModelingEngine }, { createInterchangeEngine }] = await Promise.all([
      import('@core/access/shape'),
      import('@core/engines/modeling'),
      import('@core/engines/interchange'),
    ]);
    const shapes = createShapeAccess();
    return { modeling: createModelingEngine(shapes), interchange: createInterchangeEngine(shapes) };
  })();
  return { modeling: deferred(engines, 'modeling'), interchange: deferred(engines, 'interchange') };
}

/** An engine whose (async) methods wait for it to load. */
function deferred<K extends keyof Geometry>(engines: Promise<Geometry>, key: K): Geometry[K] {
  return new Proxy({} as Geometry[K], {
    get: (_target, method) => async (...args: unknown[]) => {
      const engine = (await engines)[key] as unknown as Record<string | symbol, (...a: unknown[]) => unknown>;
      return (engine[method] as (...a: unknown[]) => unknown).apply(engine, args);
    },
  });
}

export function createCore(host: Host): Core {
  const events = new EventBus<DomainEvents>();
  const { projects, documents, assets, externalFiles } = host;
  const geometry: Geometry = host.geometry
    ? { modeling: remote<ModelingEngine>(host.geometry, 'modeling'), interchange: remote<InterchangeEngine>(host.geometry, 'interchange') }
    : localGeometry();
  return {
    projectManager: createProjectManager({ projects, documents, assets, events, clock: systemClock, newId }),
    designManager: createDesignManager({
      documents,
      externalFiles,
      sketches: createSketchEngine(host.solverWasmUrl ? { wasmUrl: host.solverWasmUrl } : {}),
      parameters: createParameterEngine(),
      modeling: geometry.modeling,
      interchange: geometry.interchange,
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
