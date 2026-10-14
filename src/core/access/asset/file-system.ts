import type { AssetId } from '@core/contracts';
import { type FileSystem, joinPath } from '@core/utilities/file-system';
import type { Asset, AssetAccess, AssetMeta } from './asset-access';

/** Desktop store: `projects/<projectId>/assets/<assetId>.bin` plus a `.json` with its metadata. */
export class FileSystemAssetAccess implements AssetAccess {
  constructor(private readonly fs: FileSystem) {}

  async keep(asset: Asset): Promise<void> {
    const { bytes, ...meta } = asset;
    const base = basePath(asset.projectId, asset.id);
    await this.fs.writeBytes(`${base}.bin`, bytes);
    await this.fs.writeText(`${base}.json`, JSON.stringify(meta, null, 2));
  }

  async fetch(id: AssetId): Promise<Asset | undefined> {
    const base = await this.locate(id);
    if (!base) return undefined;
    const meta = JSON.parse(await this.fs.readText(`${base}.json`)) as AssetMeta;
    return { ...meta, bytes: await this.fs.readBytes(`${base}.bin`) };
  }

  async release(id: AssetId): Promise<void> {
    const base = await this.locate(id);
    if (!base) return;
    await this.fs.remove(`${base}.bin`);
    await this.fs.remove(`${base}.json`);
  }

  private async locate(id: string): Promise<string | undefined> {
    for (const projectId of await this.fs.list('projects')) {
      const base = basePath(projectId, id);
      if (await this.fs.exists(`${base}.json`)) return base;
    }
    return undefined;
  }
}

const basePath = (projectId: string, id: string) => joinPath('projects', projectId, 'assets', id);
