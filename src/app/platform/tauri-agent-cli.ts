import { invoke } from '@tauri-apps/api/core';

/** Desktop: the command line installed next to the app, as the Rust shell finds it (CAD-132). */
export const tauriAgentCli = {
  path: async (): Promise<string | undefined> => (await invoke<string | null>('agent_cli')) ?? undefined,
};
