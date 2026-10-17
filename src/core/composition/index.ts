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
import { GitVersionAccess, type VersionAccess } from '@core/access/version';
import type { DomainEvents, TextWeight } from '@core/contracts';
import type { AnalysisEngine } from '@core/engines/analysis';
import type { InterchangeEngine } from '@core/engines/interchange';
import { createKinematicsEngine } from '@core/engines/kinematics';
import type { ModelingEngine } from '@core/engines/modeling';
import { createParameterEngine } from '@core/engines/parameter';
import { createSketchEngine } from '@core/engines/sketch';
import { fontSource } from '@core/utilities/text';
import { type AssemblyManager, createAssemblyManager } from '@core/managers/assembly';
import { createDesignManager, type DesignManager } from '@core/managers/design';
import type { DrawingManager, DrawingManagerDependencies } from '@core/managers/drawing';
import { createProjectManager, type ProjectManager } from '@core/managers/project';
import { systemClock } from '@core/utilities/clock';
import { type FileSystem, IndexedDbFileSystem, MemoryFileSystem } from '@core/utilities/file-system';
import { newId } from '@core/utilities/identity';
import { EventBus, type MessageChannelLike, type Port, relayEvents, remote } from '@core/utilities/messaging';

/** Everything a client may use: the managers, plus where projects are kept. */
export interface Core {
  readonly projectManager: ProjectManager;
  readonly designManager: DesignManager;
  readonly assemblyManager: AssemblyManager;
  readonly drawingManager: DrawingManager;
  readonly storage: StorageKind;
  /**
   * Resolves once the work events started is done: components regenerated for assemblies, their
   * results written. A script waits for it before its process ends (CAD-119).
   */
  settled(): Promise<void>;
}

export type StorageKind = 'browser' | 'project-folders' | 'memory';

/** What a host provides; the only things that differ between browser, desktop and tests. */
export interface Host {
  readonly kind: StorageKind;
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly externalFiles: ExternalFileAccess;
  /** Each project's version history. */
  readonly versions: VersionAccess;
  /** Where the browser loads the constraint solver from; Node finds it on its own. */
  readonly solverWasmUrl?: string;
  /** Where the browser loads the bundled fonts from; Node reads them from the font package. */
  readonly fontUrls?: Readonly<Record<TextWeight, string>>;
  /** Port to the geometry worker; without it the geometry kernel runs in this thread (Node, tests). */
  readonly geometry?: Port;
  /** Where events are shared with the app's other tabs and windows (a `BroadcastChannel`). */
  readonly channel?: MessageChannelLike;
}

/**
 * Events other tabs and windows hear about (CAD-82), by the name they hear them by: a saved document
 * is `documentChanged` there, so only the tab that saved it records a version.
 */
const relayed: Partial<Record<keyof DomainEvents, keyof DomainEvents>> = {
  documentSaved: 'documentChanged',
  documentRenamed: 'documentRenamed',
  documentRestored: 'documentRestored',
  documentDeleted: 'documentDeleted',
  projectParametersChanged: 'projectParametersChanged',
  componentRegenerated: 'componentRegenerated',
  resultPublished: 'resultPublished',
};

export interface HostOptions {
  readonly solverWasmUrl?: string;
  readonly fontUrls?: Readonly<Record<TextWeight, string>>;
  readonly geometry?: Port;
  readonly channel?: MessageChannelLike;
}

interface Geometry {
  readonly modeling: ModelingEngine;
  readonly interchange: InterchangeEngine;
  readonly analysis: AnalysisEngine;
}

/**
 * The kernel-bound engines in this thread (Node, tests), sharing one shape store. Loaded on first use,
 * so browser bundles, which use the worker, never include the kernel.
 */
function localGeometry(): Geometry {
  const engines = (async (): Promise<Geometry> => {
    const [{ createShapeAccess }, { createModelingEngine }, { createInterchangeEngine }, { createAnalysisEngine }] = await Promise.all([
      import('@core/access/shape'),
      import('@core/engines/modeling'),
      import('@core/engines/interchange'),
      import('@core/engines/analysis'),
    ]);
    const shapes = createShapeAccess();
    return { modeling: createModelingEngine(shapes), interchange: createInterchangeEngine(shapes), analysis: createAnalysisEngine(shapes) };
  })();
  return { modeling: deferred(engines, 'modeling'), interchange: deferred(engines, 'interchange'), analysis: deferred(engines, 'analysis') };
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

/** The Drawing Manager, loaded with its first drawing: most sessions never open one. */
function lazyDrawingManager(deps: DrawingManagerDependencies): DrawingManager {
  let manager: Promise<DrawingManager> | undefined;
  return {
    open: async (documentId) => {
      manager ??= import('@core/managers/drawing').then(({ createDrawingManager }) => createDrawingManager(deps));
      return (await manager).open(documentId);
    },
  };
}

export function createCore(host: Host): Core {
  const events = new EventBus<DomainEvents>();
  if (host.channel) relayEvents(events, host.channel, relayed);
  const { projects, documents, assets, externalFiles } = host;
  const fonts = fontSource(host.fontUrls);
  const geometry: Geometry = host.geometry
    ? {
        modeling: remote<ModelingEngine>(host.geometry, 'modeling'),
        interchange: remote<InterchangeEngine>(host.geometry, 'interchange'),
        analysis: remote<AnalysisEngine>(host.geometry, 'analysis'),
      }
    : localGeometry();
  return {
    projectManager: createProjectManager({
      projects,
      documents,
      assets,
      externalFiles,
      interchange: geometry.interchange,
      parameters: createParameterEngine(),
      versions: host.versions,
      events,
      clock: systemClock,
      newId,
    }),
    designManager: createDesignManager({
      projects,
      documents,
      externalFiles,
      sketches: createSketchEngine({ ...(host.solverWasmUrl ? { wasmUrl: host.solverWasmUrl } : {}), fonts }),
      parameters: createParameterEngine(),
      modeling: geometry.modeling,
      interchange: geometry.interchange,
      analysis: geometry.analysis,
      assets,
      events,
      clock: systemClock,
    }),
    assemblyManager: createAssemblyManager({
      projects,
      documents,
      assets,
      externalFiles,
      modeling: geometry.modeling,
      kinematics: createKinematicsEngine(),
      analysis: geometry.analysis,
      interchange: geometry.interchange,
      events,
      clock: systemClock,
    }),
    drawingManager: lazyDrawingManager({
      projects,
      documents,
      assets,
      externalFiles,
      modeling: geometry.modeling,
      parameters: createParameterEngine(),
      events,
      clock: systemClock,
      fonts,
    }),
    storage: host.kind,
    settled: async () => {
      // Handlers publish further events (a request, then its answer): until none is left.
      for (let pending = events.drained(); ; ) {
        await pending;
        if (pending === events.drained()) return;
        pending = events.drained();
      }
    },
  };
}

/** Composition root for the browser: IndexedDB storage, exports as downloads. */
export function createBrowserCore(options: HostOptions = {}): Core {
  return createCore({
    kind: 'browser',
    projects: new IndexedDbProjectAccess(),
    documents: new IndexedDbDocumentAccess(),
    assets: new IndexedDbAssetAccess(),
    versions: new GitVersionAccess(new IndexedDbFileSystem()),
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
    // The repository lives in the project folder (`projects/<id>/.git`).
    versions: new GitVersionAccess(fileSystem),
    externalFiles,
    ...options,
  });
}

/** Composition root without persistence, for component tests, demos and file conversions. */
export function createInMemoryCore(options: HostOptions & { readonly externalFiles?: ExternalFileAccess } = {}): Core {
  return createCore({
    kind: 'memory',
    projects: new InMemoryProjectAccess(),
    documents: new InMemoryDocumentAccess(),
    assets: new InMemoryAssetAccess(),
    versions: new GitVersionAccess(new MemoryFileSystem()),
    externalFiles: new InMemoryExternalFileAccess(),
    ...options,
  });
}
