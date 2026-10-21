import type {
  Attachment,
  BoardSummary,
  BodyMesh,
  ConflictChoice,
  CreatableDocumentKind,
  DocumentId,
  DocumentSummary,
  ImportFormat,
  LibraryLink,
  LibraryPart,
  LibrarySummary,
  MeshRepair,
  Parameter,
  ProjectId,
  ProjectRemote,
  ProjectSummary,
  ProjectTemplate,
  RemoteCredentials,
  Result,
  SketchEntity,
  SyncOutcome,
  TextOutlines,
  TrashItem,
  Vec3,
  Version,
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
      /** A circuit board: its holes and parts (CAD-170). */
      readonly board?: BoardSummary;
    }
  /** A drawing's sketch entities, with the outlines of its texts. */
  | { readonly kind: 'drawing'; readonly entities: readonly SketchEntity[]; readonly texts: TextOutlines; readonly min: Vec3; readonly max: Vec3 }
  /** A picture (PNG, JPEG): its size in pixels, and its bytes to show. */
  | { readonly kind: 'picture'; readonly width: number; readonly height: number; readonly mediaType: string; readonly bytes: Uint8Array };

/** What a list of projects or documents shows has changed: read it again (CAD-150). */
export type StoreChange =
  /** The projects (a project's name, settings, notes; projects added, deleted, restored). */
  | { readonly kind: 'projects'; readonly projectId?: ProjectId }
  /**
   * A document changed in another tab, window or process, or was renamed, restored or deleted; `gone`
   * when it no longer exists. A document saved by an editor of this window is not a change.
   */
  | { readonly kind: 'document'; readonly documentId: DocumentId; readonly gone?: boolean };

/** What a file or a link to attach is. */
export type AttachmentInput = { readonly file: ExternalFile } | { readonly link: { readonly url: string; readonly name?: string } };

/** A library part whose library has a newer version than the one the project uses (CAD-151). */
export interface LibraryUpdate {
  readonly document: DocumentSummary;
  readonly link: LibraryLink;
  /** The library's latest version. */
  readonly latest: string;
}

/** A mesh simplified for use as a solid, to look at before keeping it (CAD-169). */
export interface SimplifiedImport {
  readonly content: Extract<ImportedContent, { readonly kind: 'model' }>;
  /** Triangles of the original. */
  readonly before: number;
  /** What the original needed to be closed and face outwards. */
  readonly repair: MeshRepair;
}

/** Project and document lifecycle (see docs/Architecture/Components.md#project-manager). */
export interface ProjectManager {
  /** Most recently modified first. */
  listProjects(): Promise<ProjectSummary[]>;
  findProject(id: ProjectId): Promise<ProjectSummary | undefined>;
  createProject(name: string): Promise<Result<CreatedProject>>;
  renameProject(id: ProjectId, name: string): Promise<Result<void>>;
  /** Moves the project to the trash (CAD-148): it is kept, with its documents and history, for {@link trashDays} days. */
  deleteProject(id: ProjectId): Promise<void>;
  /** Replaces the project's parameters (checked first: names, cycles, expressions); its components regenerate. */
  setProjectParameters(id: ProjectId, parameters: readonly Parameter[]): Promise<Result<void>>;

  /** Grouped by kind (components, assemblies, imported), then by name. */
  listDocuments(projectId: ProjectId): Promise<DocumentSummary[]>;
  findDocument(id: DocumentId): Promise<DocumentSummary | undefined>;
  /** Without a name, the document gets the next free default name ("Component 3"). */
  createDocument(projectId: ProjectId, kind: CreatableDocumentKind, name?: string): Promise<Result<DocumentSummary>>;
  renameDocument(id: DocumentId, name: string): Promise<Result<void>>;
  /** Moves the document to its project's trash (CAD-148); its history stays with the project. */
  deleteDocument(id: DocumentId): Promise<void>;

  /** What is in the trash, newest first; what has been there longer than {@link trashDays} days is deleted for good first. */
  listTrash(): Promise<TrashItem[]>;
  /** Brings a project or a document back from the trash, a document as it was when it was deleted. */
  restoreFromTrash(id: ProjectId | DocumentId): Promise<Result<TrashItem>>;
  /** Deletes a project or a document in the trash for good. */
  deleteFromTrash(id: ProjectId | DocumentId): Promise<Result<void>>;
  /** Deletes everything in the trash for good. */
  emptyTrash(): Promise<void>;

  /** Replaces the project's description (Markdown, CAD-149). */
  setProjectDescription(id: ProjectId, description: string): Promise<Result<void>>;
  /** Keeps a file with the project as it is, or a link. */
  addAttachment(id: ProjectId, attachment: AttachmentInput): Promise<Result<Attachment>>;
  removeAttachment(id: ProjectId, attachmentId: string): Promise<Result<void>>;
  /** An attached file's bytes. */
  attachmentFile(id: ProjectId, attachmentId: string): Promise<Result<{ readonly attachment: Attachment; readonly bytes: Uint8Array }>>;

  /** Marks the project as a library other projects use, or no longer (CAD-151). */
  setLibrary(id: ProjectId, library: boolean): Promise<Result<void>>;
  /** The built-in standard parts, then the projects marked as libraries. */
  listLibraries(): Promise<LibrarySummary[]>;
  /** The components a library offers. */
  libraryParts(library: string): Promise<Result<LibraryPart[]>>;
  /**
   * The project's document of a library part, to insert into its assemblies: the one taken before, or
   * the part as the library's latest version has it (`follow`: whether newer versions replace it on their own).
   */
  useLibraryPart(projectId: ProjectId, library: string, part: string, options?: { readonly follow?: LibraryLink['follow'] }): Promise<Result<DocumentSummary>>;
  /** The project's library parts whose library has a newer version of them. */
  libraryUpdates(projectId: ProjectId): Promise<LibraryUpdate[]>;
  /** Brings library parts (all, or those given) to their library's latest version; answers those that changed. */
  updateLibraryParts(projectId: ProjectId, documents?: readonly DocumentId[]): Promise<Result<DocumentSummary[]>>;
  /** Whether newer library versions replace the part on their own. */
  setLibraryFollow(id: DocumentId, follow: LibraryLink['follow']): Promise<Result<void>>;

  /** Tells the listener when what lists show has changed, also in other tabs, windows and processes (CAD-150). */
  watch(listener: (change: StoreChange) => void): () => void;

  importFile(projectId: ProjectId, file: ExternalFile): Promise<Result<DocumentSummary>>;
  /** Replaces an imported document's file by a newer one of the same kind (3D or drawing); what uses it regenerates. */
  replaceImported(id: DocumentId, file: ExternalFile): Promise<Result<void>>;

  /** A copy of the project (documents, originals, parameters) with a history of its own. */
  duplicateProject(id: ProjectId): Promise<Result<ProjectSummary>>;
  /** A copy of a document in its project, named "<name> (copy)". */
  duplicateDocument(id: DocumentId): Promise<Result<DocumentSummary>>;
  /** Hands the whole project over as one archive file (`.cadence`), with its version history if asked. */
  exportProject(id: ProjectId, options?: { readonly history?: boolean; readonly libraries?: boolean }): Promise<Result<void>>;
  /** A new project from an archive file made by `exportProject`. */
  importProject(file: ExternalFile): Promise<Result<ProjectSummary>>;
  /** A new project from a template; its first component is ready to open. */
  createFromTemplate(template: ProjectTemplate): Promise<Result<CreatedProject>>;

  /** Records the project as a version now (a few seconds after saves this happens on its own). */
  recordVersion(id: ProjectId, message?: string): Promise<void>;
  /** The project's versions, newest first. */
  projectHistory(id: ProjectId): Promise<Version[]>;
  /** The versions in which a document changed, newest first. */
  documentHistory(id: DocumentId): Promise<Version[]>;
  /** Brings a document back as it was in a version (a change of its own, recorded as a version). */
  restoreDocument(id: DocumentId, version: string): Promise<Result<void>>;
  /** Names a version (the latest when none is given); a name given again moves. */
  nameVersion(id: ProjectId, name: string, version?: string): Promise<Result<void>>;
  unnameVersion(id: ProjectId, name: string): Promise<void>;

  /** Shares the project's versions with a git repository; without one, stops sharing them. */
  setRemote(id: ProjectId, remote: ProjectRemote | undefined): Promise<Result<void>>;
  /**
   * Records a version, then exchanges versions with the project's remote: sends ours, takes theirs,
   * or combines both document by document. Documents changed on both sides need a choice each
   * (`resolutions`, by the conflict's path); without one, sync reports the conflicts and changes nothing.
   */
  syncProject(id: ProjectId, credentials?: RemoteCredentials, resolutions?: Readonly<Record<string, ConflictChoice>>): Promise<Result<SyncOutcome>>;
  /** A new project holding the latest version of a remote, synced with it from then on. */
  openRemoteProject(remote: ProjectRemote, credentials?: RemoteCredentials): Promise<Result<ProjectSummary>>;

  /** Keeps a picture of a document (PNG), replacing the one before. Unknown documents are ignored. */
  saveThumbnail(id: DocumentId, png: Uint8Array): Promise<void>;
  thumbnail(id: DocumentId): Promise<Uint8Array | undefined>;
  /** The picture of the project's most recently changed document that has one. */
  projectThumbnail(id: ProjectId): Promise<Uint8Array | undefined>;
  openImported(id: DocumentId): Promise<ImportedView | undefined>;
  /** Reads an imported file for the viewer. */
  previewImported(id: DocumentId): Promise<Result<ImportedContent>>;
  /**
   * A mesh file (STL, OBJ, 3MF) repaired and simplified by quadric error to about `triangles`
   * triangles, for the viewer to show before it is kept (CAD-169).
   */
  previewSimplified(id: DocumentId, triangles: number): Promise<Result<SimplifiedImport>>;
  /** Keeps the simplified mesh as a new imported file of the same format, "<name> (simplified)", next to the original. */
  simplifyImported(id: DocumentId, triangles: number): Promise<Result<DocumentSummary>>;
  /** Hands the imported file to the user in another format (drawings as drawings, 3D files as 3D files). */
  exportImported(id: DocumentId, format: ImportFormat): Promise<Result<void>>;
  /** Hands a file the editor made (a picture, a video) to the user: a download or a save dialog. */
  deliverFile(file: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }): Promise<void>;
}
