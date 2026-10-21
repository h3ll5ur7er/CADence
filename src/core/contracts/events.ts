import type { DocumentId, ProjectId } from './ids';

/** Queued domain events published by managers (manager → manager calls are queued only). */
export interface DomainEvents {
  readonly projectDeleted: { readonly projectId: ProjectId };
  /** A project's settings changed in another process (its folder watched, CAD-150): lists read it again. */
  readonly projectChanged: { readonly projectId: ProjectId };
  /** The project's parameters changed: its components regenerate. */
  readonly projectParametersChanged: { readonly projectId: ProjectId };
  /** A document was added to a project (created, imported, copied, taken from a library): lists show it. */
  readonly documentCreated: { readonly projectId: ProjectId; readonly documentId: DocumentId };
  readonly documentRenamed: { readonly documentId: DocumentId; readonly name: string };
  /** A document was brought back as it was in an earlier version: editors and assemblies showing it reload it. */
  readonly documentRestored: { readonly documentId: DocumentId };
  /** An editor saved a change of a document: the project's version history records it soon. */
  readonly documentSaved: { readonly projectId: ProjectId; readonly documentId: DocumentId };
  readonly documentDeleted: { readonly documentId: DocumentId };
  /** A component's or an assembly's result was published: drawings of it read it again. */
  readonly resultPublished: { readonly documentId: DocumentId; readonly configuration?: string };
  /** A document was saved in another tab or window of the app (relayed): what shows it reads it again. */
  readonly documentChanged: { readonly documentId: DocumentId };
  /** A request to the Design Manager: bring the component's published result up to date (ADR-11). */
  readonly regenerateComponent: { readonly documentId: DocumentId; readonly configuration?: string };
  /** The Design Manager's answer: the result is published, or the component could not be loaded. */
  readonly componentRegenerated: { readonly documentId: DocumentId; readonly configuration?: string; readonly ok: boolean };
}
