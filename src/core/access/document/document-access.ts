import type { CadDocument, DocumentId, DocumentSummary, ProjectId } from '@core/contracts';

/** Atomic business verbs over the document store. Documents are migrated to the current schema on load. */
export interface DocumentAccess {
  enumerate(projectId: ProjectId): Promise<DocumentSummary[]>;
  load(id: DocumentId): Promise<CadDocument | undefined>;
  /** Creates or replaces the document. */
  store(document: CadDocument): Promise<void>;
  /** Removes the document; unknown ids are ignored. */
  discard(id: DocumentId): Promise<void>;
}
