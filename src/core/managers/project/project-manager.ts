import type {
  BodyMesh,
  CreatableDocumentKind,
  DocumentId,
  DocumentSummary,
  ImportFormat,
  Parameter,
  ProjectId,
  ProjectSummary,
  Result,
  SketchEntity,
  TextOutlines,
  Vec3,
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

/** What an imported file holds, for the imported viewer. */
export type ImportedContent =
  | {
      readonly kind: 'model';
      readonly meshes: readonly BodyMesh[];
      readonly triangles: number;
      /** mm³, from the triangles. */
      readonly volume: number;
      readonly min: Vec3;
      readonly max: Vec3;
      /** Whether components and assemblies can use it as a solid (meshes up to a size). */
      readonly usableAsSolid: boolean;
    }
  /** A drawing's sketch entities, with the outlines of its texts. */
  | { readonly kind: 'drawing'; readonly entities: readonly SketchEntity[]; readonly texts: TextOutlines; readonly min: Vec3; readonly max: Vec3 };

/** Project and document lifecycle (see docs/Architecture/Components.md#project-manager). */
export interface ProjectManager {
  /** Most recently modified first. */
  listProjects(): Promise<ProjectSummary[]>;
  findProject(id: ProjectId): Promise<ProjectSummary | undefined>;
  createProject(name: string): Promise<Result<CreatedProject>>;
  renameProject(id: ProjectId, name: string): Promise<Result<void>>;
  deleteProject(id: ProjectId): Promise<void>;
  /** Replaces the project's parameters (checked first: names, cycles, expressions); its components regenerate. */
  setProjectParameters(id: ProjectId, parameters: readonly Parameter[]): Promise<Result<void>>;

  /** Grouped by kind (components, assemblies, imported), then by name. */
  listDocuments(projectId: ProjectId): Promise<DocumentSummary[]>;
  findDocument(id: DocumentId): Promise<DocumentSummary | undefined>;
  /** Without a name, the document gets the next free default name ("Component 3"). */
  createDocument(projectId: ProjectId, kind: CreatableDocumentKind, name?: string): Promise<Result<DocumentSummary>>;
  renameDocument(id: DocumentId, name: string): Promise<Result<void>>;
  deleteDocument(id: DocumentId): Promise<void>;

  importFile(projectId: ProjectId, file: ExternalFile): Promise<Result<DocumentSummary>>;

  /** Keeps a picture of a document (PNG), replacing the one before. Unknown documents are ignored. */
  saveThumbnail(id: DocumentId, png: Uint8Array): Promise<void>;
  thumbnail(id: DocumentId): Promise<Uint8Array | undefined>;
  /** The picture of the project's most recently changed document that has one. */
  projectThumbnail(id: ProjectId): Promise<Uint8Array | undefined>;
  openImported(id: DocumentId): Promise<ImportedView | undefined>;
  /** Reads an imported file for the viewer. */
  previewImported(id: DocumentId): Promise<Result<ImportedContent>>;
  /** Hands the imported file to the user in another format (drawings as drawings, 3D files as 3D files). */
  exportImported(id: DocumentId, format: ImportFormat): Promise<Result<void>>;
}
