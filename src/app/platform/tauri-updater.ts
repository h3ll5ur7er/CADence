import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';

/**
 * Desktop: asks the GitHub releases for a newer, signed version (`plugins.updater` in tauri.conf.json),
 * installs it and starts again.
 */
export class TauriUpdater {
  private update: Update | undefined;

  /** The newer version's number; undefined when there is none or the check failed (e.g. offline). */
  async check(): Promise<string | undefined> {
    try {
      this.update = (await check()) ?? undefined;
    } catch {
      this.update = undefined;
    }
    return this.update?.version;
  }

  async install(): Promise<void> {
    if (!this.update) return;
    await this.update.downloadAndInstall();
    await relaunch();
  }
}
