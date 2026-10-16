import { invoke } from '@tauri-apps/api/core';

/** Desktop: the files the app was started with (Open with CADence, a double-clicked `.cadence` archive). */
export async function tauriOpenedFiles(): Promise<{ name: string; bytes: Uint8Array }[]> {
  const paths = await invoke<string[]>('opened_files');
  return Promise.all(
    paths.map(async (path) => ({
      name: path.split(/[\\/]/).pop() ?? path,
      bytes: new Uint8Array(await invoke<ArrayBuffer>('read_opened_file', { path })),
    })),
  );
}
