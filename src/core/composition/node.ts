import { type MessagePort, Worker } from 'node:worker_threads';
import { FolderDeliveryAccess } from '@core/access/external-file/node';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { expose, type Port, restartable, type StoppablePort } from '@core/utilities/messaging';
import type { TextWeight } from '@core/utilities/text';
import { type Core, createDesktopCore, createInMemoryCore, type HostOptions } from './index';

/**
 * Where Node reads the kernels' WebAssembly and the bundled fonts from, when not from their
 * packages: the self-contained binary unpacks them (CAD-131).
 */
export interface NodeResources {
  readonly kernel: string;
  readonly solver: string;
  readonly fonts: Readonly<Record<TextWeight, string>>;
}

/** A core in Node, with where its exports were written. */
export interface NodeCore extends Core {
  readonly exports: FolderDeliveryAccess;
}

/**
 * Composition root for Node (scripts, the command line, the MCP server): projects as folders in the
 * desktop app's layout (or in memory, without a folder), exports written to a folder. The geometry
 * kernel runs in this thread; drawing views in a worker when `views` starts one (CAD-125).
 */
export function createNodeCore(options: {
  readonly projects?: string;
  readonly exports: string;
  readonly views?: () => StoppablePort;
  /** Starts a worker for the geometry kernel (`serveGeometry`), so a long computation leaves this thread free and can be stopped (CAD-134). */
  readonly geometry?: () => StoppablePort;
  readonly resources?: NodeResources;
}): NodeCore {
  const exports = new FolderDeliveryAccess(options.exports);
  const { resources } = options;
  const worker = options.geometry && restartable(options.geometry);
  const host: HostOptions = {
    ...(options.views ? { views: options.views } : {}),
    ...(worker ? { geometry: worker.port, restarts: worker.restarts, stopGeometry: () => worker.restart(Object.assign(new Error('The computation was cancelled.'), { name: 'CancelledError' })) } : {}),
    ...(resources ? { kernelWasmUrl: resources.kernel, solverWasmUrl: resources.solver, fontUrls: resources.fonts } : {}),
  };
  const core = options.projects ? createDesktopCore(new NodeFileSystem(options.projects), exports, host) : createInMemoryCore({ externalFiles: exports, ...host });
  return { ...core, exports };
}

/** Starts a Node worker running `module` (a URL or a path) with `data`, as a port the RPC helpers speak to. */
export function nodeWorker(module: URL | string, data: unknown): StoppablePort {
  const worker = new Worker(module, { workerData: data });
  // The kernel's worker must not keep the process alive once the command is done.
  worker.unref();
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer as never),
    addEventListener: (_type, listener) => void worker.on('message', (data: unknown) => listener({ data } as MessageEvent)),
    terminate: () => void worker.terminate(),
  };
}

/**
 * Serves the geometry kernel's engines to the thread that started this worker (`nodeWorker`), as
 * the browser's geometry worker does (CAD-134), and tells it when the kernel failed beyond repair.
 */
export async function serveGeometry(parent: MessagePort, resources?: NodeResources): Promise<void> {
  const [{ createShapeAccess }, { createModelingEngine }, { createInterchangeEngine }, { createAnalysisEngine }, { fontSource }] = await Promise.all([
    import('@core/access/shape'),
    import('@core/engines/modeling'),
    import('@core/engines/interchange'),
    import('@core/engines/analysis'),
    import('@core/utilities/text'),
  ]);
  const port = parentPortOf(parent);
  const shapes = createShapeAccess({ ...(resources ? { wasmUrl: resources.kernel } : {}), onFailure: () => port.postMessage({ cadence: 'kernel-failed' }) });
  expose(port, { modeling: createModelingEngine(shapes), interchange: createInterchangeEngine(shapes, fontSource(resources?.fonts)), analysis: createAnalysisEngine(shapes) });
}

/** A worker's parent port as the RPC helpers speak to it. */
function parentPortOf(parent: MessagePort): Port {
  return {
    postMessage: (message, transfer) => parent.postMessage(message, transfer as never),
    addEventListener: (_type, listener) => void parent.on('message', (data: unknown) => listener({ data } as MessageEvent)),
  };
}

/** Serves a kernel of its own for drawing views to the thread that started this worker (`nodeWorker`); `kernel` is where its WebAssembly is. */
export async function serveViews(parent: MessagePort, kernel?: string): Promise<void> {
  const [{ createShapeAccess }, { createModelingEngine }] = await Promise.all([import('@core/access/shape'), import('@core/engines/modeling')]);
  expose(parentPortOf(parent), { modeling: createModelingEngine(createShapeAccess(kernel ? { wasmUrl: kernel } : {})) });
}
