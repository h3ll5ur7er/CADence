import type {
  CreatableDocumentKind,
  DocumentId,
  DocumentSummary,
  ImportFormat,
  ProjectId,
  ProjectSummary,
  Result,
} from '@core/contracts';

/** A file chosen by the user (picker or drag and drop); reading it is a client concern. */
export interface ExternalFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface CreatedProject {
  readonly project: ProjectSummary;
  /** The component every new project starts with, so the editor has something to open. */
  readonly firstDocument: DocumentSummary;
}

export interface ImportedView {
  readonly document: DocumentSummary;
  readonly format: ImportFormat;
  readonly fileName: string;
  readonly byteLength: number;
}

/** Project and document lifecycle (see docs/Architecture/Components.md#project-manager). */
export interface ProjectManager {
  /** Most recently modified first. */
  listProjects(): Promise<ProjectSummary[]>;
  findProject(id: ProjectId): Promise<ProjectSummary | undefined>;
  createProject(name: string): Promise<Result<CreatedProject>>;
  renameProject(id: ProjectId, name: string): Promise<Result<void>>;
  deleteProject(id: ProjectId): Promise<void>;

  /** Grouped by kind (components, assemblies, imported), then by name. */
  listDocuments(projectId: ProjectId): Promise<DocumentSummary[]>;
  findDocument(id: DocumentId): Promise<DocumentSummary | undefined>;
  /** Without a name, the document gets the next free default name ("Component 3"). */
  createDocument(projectId: ProjectId, kind: CreatableDocumentKind, name?: string): Promise<Result<DocumentSummary>>;
  renameDocument(id: DocumentId, name: string): Promise<Result<void>>;
  deleteDocument(id: DocumentId): Promise<void>;

  importFile(projectId: ProjectId, file: ExternalFile): Promise<Result<DocumentSummary>>;
  openImported(id: DocumentId): Promise<ImportedView | undefined>;
}
