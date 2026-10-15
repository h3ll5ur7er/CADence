import type { DocumentId, ProjectId } from './ids';

/** Queued domain events published by managers (manager → manager calls are queued only). */
export interface DomainEvents {
  readonly projectDeleted: { readonly projectId: ProjectId };
  readonly documentRenamed: { readonly documentId: DocumentId; readonly name: string };
  readonly documentDeleted: { readonly documentId: DocumentId };
  /** A request to the Design Manager: bring the component's published result up to date (ADR-11). */
  readonly regenerateComponent: { readonly documentId: DocumentId };
  /** The Design Manager's answer: the result is published, or the component could not be loaded. */
  readonly componentRegenerated: { readonly documentId: DocumentId; readonly ok: boolean };
}
