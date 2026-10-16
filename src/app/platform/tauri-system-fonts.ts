import { invoke } from '@tauri-apps/api/core';

/** Desktop: the font files installed on this computer (TTF, OTF), listed and read by the Rust shell. */
export const tauriSystemFonts = {
  list: () => invoke<string[]>('system_fonts'),
  read: async (name: string) => ({ name, bytes: new Uint8Array(await invoke<ArrayBuffer>('read_system_font', { name })) }),
};
