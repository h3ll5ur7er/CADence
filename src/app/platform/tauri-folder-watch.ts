import type { FolderWatch } from '@core/utilities/file-system';
import { BaseDirectory, watch } from '@tauri-apps/plugin-fs';
import type { TauriFileSystem } from './tauri-file-system';

/** A watched path as the app's file system names it: from `projects/` on, however the system spells the app data folder. */
const relative = (path: string) => {
  const slashed = path.replaceAll('\\', '/');
  const at = slashed.lastIndexOf('/projects/');
  return at < 0 ? slashed : slashed.slice(at + 1);
};

/**
 * Watches the project folders in the app data folder (CAD-150), so documents an agent's MCP server or
 * a script changes show in the app: reports the paths other processes changed, relative to that folder.
 */
export function watchProjectFolders(fileSystem: TauriFileSystem): FolderWatch {
  return (listener) =>
    void (async () => {
      await fileSystem.makeDirectory('projects');
      await watch(
        'projects',
        (event) => {
          // Only documents and project records matter; versions, results and files being written do not.
          const paths = event.paths.map(relative).filter((path) => /^projects\/[^/]+\/(project\.json|documents\/[^/]+\.json)$/.test(path));
          if (paths.length) void fileSystem.notWrittenHere(paths).then((changed) => changed.length && listener(changed));
        },
        { baseDir: BaseDirectory.AppData, recursive: true, delayMs: 300 },
      );
    })().catch((error: unknown) => console.warn('The project folders are not watched:', error));
}
