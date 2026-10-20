import type { FolderWatch } from '@core/utilities/file-system';
import { appDataDir } from '@tauri-apps/api/path';
import { BaseDirectory, watch } from '@tauri-apps/plugin-fs';
import type { TauriFileSystem } from './tauri-file-system';

/**
 * Watches the project folders in the app data folder (CAD-150), so documents an agent's MCP server or
 * a script changes show in the app: reports the paths other processes changed, relative to that folder.
 */
export function watchProjectFolders(fileSystem: TauriFileSystem): FolderWatch {
  return (listener) =>
    void (async () => {
      const root = (await appDataDir()).replaceAll('\\', '/').replace(/\/+$/, '');
      await fileSystem.makeDirectory('projects');
      await watch(
        'projects',
        (event) => {
          // Only documents and project records matter; versions, results and files being written do not.
          const paths = event.paths
            .map((path) => path.replaceAll('\\', '/'))
            .map((path) => (path.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? path.slice(root.length + 1) : path))
            .filter((path) => /^projects\/[^/]+\/(project\.json|documents\/[^/]+\.json)$/.test(path));
          if (paths.length) void fileSystem.notWrittenHere(paths).then((changed) => changed.length && listener(changed));
        },
        { baseDir: BaseDirectory.AppData, recursive: true, delayMs: 300 },
      );
    })().catch((error: unknown) => console.warn('The project folders are not watched:', error));
}
