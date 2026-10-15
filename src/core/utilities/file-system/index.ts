/**
 * The few file operations the desktop storage needs, with '/'-separated paths relative to a root
 * the host chooses. Hosts implement it (Tauri in the app, Node in tests).
 */
export interface FileSystem {
  exists(path: string): Promise<boolean>;
  /** Whether the path is a directory (false when it is a file or does not exist). */
  isDirectory(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Names of the entries directly inside `path`; empty when the directory does not exist. */
  list(path: string): Promise<string[]>;
  makeDirectory(path: string): Promise<void>;
  /** Removes a file or a whole directory tree; missing paths are ignored. */
  remove(path: string): Promise<void>;
}

export const joinPath = (...parts: string[]): string => parts.filter(Boolean).join('/');

export { IndexedDbFileSystem } from './indexed-db';
export { MemoryFileSystem } from './memory';
