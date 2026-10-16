import type { AssetId, DocumentId } from '@core/contracts';
import { type FileSystem, joinPath } from '@core/utilities/file-system';
import { type Asset, type AssetAccess, type AssetMeta, type ComponentResult, resultKey } from './asset-access';

/**
 * Desktop store: `projects/<projectId>/assets/<assetId>.bin` plus a `.json` with its metadata, and
 * component results as `projects/<projectId>/results/<documentId>.bin` and `.json`.
 */
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
    const meta = base && (await this.metadata<AssetMeta>(base));
    return meta ? { ...meta, bytes: await this.fs.readBytes(`${base}.bin`) } : undefined;
  }

  async release(id: AssetId): Promise<void> {
    const base = await this.locate(id);
    if (!base) return;
    await this.fs.remove(`${base}.bin`);
    await this.fs.remove(`${base}.json`);
  }

  async publishResult(result: ComponentResult): Promise<void> {
    const { bytes, ...meta } = result;
    const base = joinPath('projects', result.projectId, 'results', resultKey(result.documentId, result.configuration));
    await this.fs.writeBytes(`${base}.bin`, bytes);
    await this.fs.writeText(`${base}.json`, JSON.stringify(meta, null, 2));
  }

  /** The result, or nothing when it cannot be read: it is built again from the document (CAD-119). */
  async latestResult(documentId: DocumentId, configuration?: string): Promise<ComponentResult | undefined> {
    const base = await this.locate(resultKey(documentId, configuration), 'results');
    const meta = base && (await this.metadata<Omit<ComponentResult, 'bytes'>>(base));
    return meta ? { ...meta, bytes: await this.fs.readBytes(`${base}.bin`) } : undefined;
  }

  async discardResult(documentId: DocumentId): Promise<void> {
    for (const projectId of await this.fs.list('projects')) {
      const folder = joinPath('projects', projectId, 'results');
      const files = (await this.fs.exists(folder)) ? await this.fs.list(folder) : [];
      for (const file of files) {
        if (file.startsWith(`${documentId}.`) || file.startsWith(`${documentId}@`)) await this.fs.remove(joinPath(folder, file));
      }
    }
  }

  /**
   * The metadata next to the bytes, or nothing when it is empty or cut short: a process that ended
   * while writing it left an empty file, which stopped the whole assembly from opening (CAD-119).
   */
  private async metadata<T>(base: string): Promise<T | undefined> {
    try {
      return JSON.parse(await this.fs.readText(`${base}.json`)) as T;
    } catch {
      return undefined;
    }
  }

  private async locate(id: string, folder: 'assets' | 'results' = 'assets'): Promise<string | undefined> {
    for (const projectId of await this.fs.list('projects')) {
      const base = joinPath('projects', projectId, folder, id);
      if (await this.fs.exists(`${base}.json`)) return base;
    }
    return undefined;
  }
}

const basePath = (projectId: string, id: string) => joinPath('projects', projectId, 'assets', id);
