import { FolderDeliveryAccess } from '@core/access/external-file/node';
import { NodeFileSystem } from '@core/utilities/file-system/node';
import { type Core, createDesktopCore, createInMemoryCore } from './index';

/** A core in Node, with where its exports were written. */
export interface NodeCore extends Core {
  readonly exports: FolderDeliveryAccess;
}

/**
 * Composition root for Node (scripts, the command line, the MCP server): projects as folders in the
 * desktop app's layout (or in memory, without a folder), exports written to a folder. The geometry
 * kernel runs in this thread.
 */
export function createNodeCore(options: { readonly projects?: string; readonly exports: string }): NodeCore {
  const exports = new FolderDeliveryAccess(options.exports);
  const core = options.projects ? createDesktopCore(new NodeFileSystem(options.projects), exports) : createInMemoryCore({ externalFiles: exports });
  return { ...core, exports };
}
