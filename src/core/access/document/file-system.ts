import {
  type CadDocument,
  type DocumentId,
  type DocumentSummary,
  type ProjectId,
  summarize,
} from '@core/contracts';
import { type FileSystem, joinPath } from '@core/utilities/file-system';
import type { DocumentAccess } from './document-access';
import { migrate } from './migrations';

/** Desktop store: human-readable `projects/<projectId>/documents/<documentId>.json`. */
export class FileSystemDocumentAccess implements DocumentAccess {
  /** Document id → project id, learned on store and on lookup. */
  private readonly owners = new Map<string, string>();

  constructor(private readonly fs: FileSystem) {}

  async enumerate(projectId: ProjectId): Promise<DocumentSummary[]> {
    const files = (await this.fs.list(folder(projectId))).filter((name) => name.endsWith('.json'));
    const documents = await Promise.all(files.map((name) => this.read(joinPath(folder(projectId), name))));
    return documents.map(summarize);
  }

  async load(id: DocumentId): Promise<CadDocument | undefined> {
    const projectId = await this.ownerOf(id);
    return projectId === undefined ? undefined : this.read(path(projectId, id));
  }

  async store(document: CadDocument): Promise<void> {
    await this.fs.writeText(path(document.projectId, document.id), JSON.stringify(document, null, 2));
    this.owners.set(document.id, document.projectId);
  }

  async discard(id: DocumentId): Promise<void> {
    const projectId = await this.ownerOf(id);
    if (projectId === undefined) return;
    await this.fs.remove(path(projectId, id));
    this.owners.delete(id);
  }

  private async read(file: string): Promise<CadDocument> {
    return migrate(JSON.parse(await this.fs.readText(file)) as Record<string, unknown>);
  }

  private async ownerOf(id: string): Promise<string | undefined> {
    const known = this.owners.get(id);
    if (known !== undefined && (await this.fs.exists(path(known, id)))) return known;
    for (const projectId of await this.fs.list('projects')) {
      if (await this.fs.exists(path(projectId, id))) {
        this.owners.set(id, projectId);
        return projectId;
      }
    }
    return undefined;
  }
}

const folder = (projectId: string) => joinPath('projects', projectId, 'documents');
const path = (projectId: string, id: string) => joinPath(folder(projectId), `${id}.json`);
