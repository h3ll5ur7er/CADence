import { type MessagePort, Worker } from 'node:worker_threads';
import { FolderDeliveryAccess } from '@core/access/external-file/node';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { expose, type Port, type StoppablePort } from '@core/utilities/messaging';
import { type Core, createDesktopCore, createInMemoryCore } from './index';

/** A core in Node, with where its exports were written. */
export interface NodeCore extends Core {
  readonly exports: FolderDeliveryAccess;
}

/**
 * Composition root for Node (scripts, the command line, the MCP server): projects as folders in the
 * desktop app's layout (or in memory, without a folder), exports written to a folder. The geometry
 * kernel runs in this thread; drawing views in a worker when `views` starts one (CAD-125).
 */
export function createNodeCore(options: { readonly projects?: string; readonly exports: string; readonly views?: () => StoppablePort }): NodeCore {
  const exports = new FolderDeliveryAccess(options.exports);
  const host = options.views ? { views: options.views } : {};
  const core = options.projects ? createDesktopCore(new NodeFileSystem(options.projects), exports, host) : createInMemoryCore({ externalFiles: exports, ...host });
  return { ...core, exports };
}

/** Starts a Node worker running `module` with `data`, as a port the RPC helpers speak to. */
export function nodeWorker(module: URL, data: unknown): StoppablePort {
  const worker = new Worker(module, { workerData: data });
  // The kernel's worker must not keep the process alive once the command is done.
  worker.unref();
  return {
    postMessage: (message, transfer) => worker.postMessage(message, transfer as never),
    addEventListener: (_type, listener) => void worker.on('message', (data: unknown) => listener({ data } as MessageEvent)),
    terminate: () => void worker.terminate(),
  };
}

/** Serves a kernel of its own for drawing views to the thread that started this worker (`nodeWorker`). */
export async function serveViews(parent: MessagePort): Promise<void> {
  const [{ createShapeAccess }, { createModelingEngine }] = await Promise.all([import('@core/access/shape'), import('@core/engines/modeling')]);
  const port: Port = {
    postMessage: (message, transfer) => parent.postMessage(message, transfer as never),
    addEventListener: (_type, listener) => void parent.on('message', (data: unknown) => listener({ data } as MessageEvent)),
  };
  expose(port, { modeling: createModelingEngine(createShapeAccess()) });
}
