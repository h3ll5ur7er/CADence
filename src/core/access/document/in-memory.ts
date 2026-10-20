import type { CadDocument, DocumentId, DocumentSummary, ProjectId } from '@core/contracts';
import type { DocumentAccess } from './document-access';
import { migrate, summaryOf } from './migrations';

export class InMemoryDocumentAccess implements DocumentAccess {
  private readonly documents = new Map<DocumentId, string>();

  async enumerate(projectId: ProjectId): Promise<DocumentSummary[]> {
    return [...this.documents.values()]
      .map((json) => summaryOf(JSON.parse(json)))
      .filter((d) => d.projectId === projectId);
  }

  async load(id: DocumentId): Promise<CadDocument | undefined> {
    const json = this.documents.get(id);
    return json === undefined ? undefined : migrate(JSON.parse(json));
  }

  /** Stored as JSON so tests see the same copy semantics as a real store. */
  async store(document: CadDocument): Promise<void> {
    this.documents.set(document.id, JSON.stringify(document));
  }

  async discard(id: DocumentId): Promise<void> {
    this.documents.delete(id);
  }
}
