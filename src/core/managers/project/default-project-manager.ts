import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import type { ProjectAccess } from '@core/access/project';
import {
  asAssetId,
  asDocumentId,
  asProjectId,
  type AssetId,
  type Attachment,
  type CadDocument,
  type ConflictChoice,
  type CreatableDocumentKind,
  currentSchemaVersion,
  type DocumentId,
  type DocumentKind,
  documentKinds,
  type DocumentSummary,
  type DomainEvents,
  fail,
  type ImportFormat,
  isFontFormat,
  isModelFormat,
  type LibraryLink,
  type LibraryPart,
  type LibrarySummary,
  ok,
  type Parameter,
  type Project,
  type ProjectId,
  type ProjectRemote,
  type ProjectSummary,
  type ProjectTemplate,
  type RemoteCredentials,
  type Result,
  standardLibraryId,
  summarize,
  type SyncConflict,
  type SyncOutcome,
  type TrashedDocument,
  trashDays,
  type TrashItem,
} from '@core/contracts';
import { InvalidVersionNameError, RemoteError, type Version, type VersionAccess, type VersionFile } from '@core/access/version';
import type { InterchangeEngine } from '@core/engines/interchange';
import { readZip, zip } from '@core/utilities/archive';
import { range } from '@core/utilities/math';
import { pictureSize } from '@core/utilities/picture';
import { loadFont } from '@core/utilities/text';
import type { ParameterEngine } from '@core/engines/parameter';
import type { Clock } from '@core/utilities/clock';
import type { EventBus } from '@core/utilities/messaging';
import { archiveFiles, copyOf, notesOf, type ProjectBundle, readArchive, remapIds, templateBundle, withNewIds } from './project-bundles';
import { libraryCopies } from './project-libraries';
import type { AttachmentInput, CreatedProject, ExternalFile, ImportedContent, ImportedView, LibraryUpdate, ProjectManager, StoreChange } from './project-manager';
import { findStandardPart, standardComponent, standardLibraryName, standardLibraryParts, standardParts } from './standard-library';

export interface ProjectManagerDependencies {
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly interchange: InterchangeEngine;
  /** Checks project parameters before they are saved. */
  readonly parameters: ParameterEngine;
  /** Each project's version history. */
  readonly versions: VersionAccess;
  /** How long after the last save a version is recorded (ms). */
  readonly versionDelay?: number;
  readonly events: EventBus<DomainEvents>;
  readonly clock: Clock;
  readonly newId: () => string;
}

const maxNameLength = 80;

/** Where a document is kept in the project's version history. */
const documentPath = (id: DocumentId) => `documents/${id}.json`;
/** A document as kept in the version history: without its project, which the history belongs to (on each device its own id). */
const versionText = (document: CadDocument) => JSON.stringify({ ...document, projectId: undefined }, null, 2);
const documentPattern = /^documents\/(.+)\.json$/;
/** Where an imported document's original file is kept in the version history (it never changes). */
const originalPath = (id: AssetId) => `originals/${id}`;
const isOriginal = (path: string) => path.startsWith('originals/');
const settingsPath = 'project.json';

/** Whether a remote's address can be used: git over HTTP(S). */
const validRemote = (remote: ProjectRemote) =>
  [remote.url, ...(remote.corsProxy ? [remote.corsProxy] : [])].every((url) => /^https?:\/\/[^\s/]+/.test(url));

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) =>
  a === b || (a !== undefined && b !== undefined && a.length === b.length && a.every((byte, i) => byte === b[i]));

/** Where a document's picture is kept among the project's assets. */
const thumbnailId = (documentId: DocumentId): AssetId => asAssetId(`thumbnail-${documentId}`);

const kindLabels: Readonly<Record<DocumentKind, string>> = {
  component: 'Component',
  assembly: 'Assembly',
  drawing: 'Drawing',
  imported: 'Imported',
};

const mediaTypes: Readonly<Record<ImportFormat, string>> = {
  step: 'model/step',
  stl: 'model/stl',
  obj: 'model/obj',
  '3mf': 'model/3mf',
  dxf: 'image/vnd.dxf',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
};

const formatsByExtension: Readonly<Record<string, ImportFormat>> = {
  step: 'step',
  stp: 'step',
  stl: 'stl',
  obj: 'obj',
  '3mf': '3mf',
  dxf: 'dxf',
  svg: 'svg',
  png: 'png',
  jpg: 'jpg',
  jpeg: 'jpg',
  ttf: 'ttf',
  otf: 'otf',
  woff: 'woff',
};

const formatOf = (fileName: string): ImportFormat | undefined => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? formatsByExtension[fileName.slice(dot + 1).toLowerCase()] : undefined;
};
const isDrawing = (format: ImportFormat) => format === 'dxf' || format === 'svg';

/** "<name> (copy)", short enough to be a name. */
const copyName = (name: string) => `${name.slice(0, maxNameLength - 7)} (copy)`;

function validName(name: string): Result<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > maxNameLength) {
    return fail({ code: 'invalid-name', message: `Names need 1 to ${maxNameLength} characters.` });
  }
  return ok(trimmed);
}

const unknownProject = (id: ProjectId) => fail({ code: 'unknown-project', message: `Project ${id} does not exist.` });
const notInTrash = (id: string) => fail({ code: 'not-in-trash', message: `Nothing in the trash has the id ${id}.` });
const day = 24 * 60 * 60 * 1000;
/** When something put in the trash at `time` is deleted for good. */
const expiry = (time: string) => new Date(Date.parse(time) + trashDays * day).toISOString();
/** The project with these documents in its trash (none: no trash). */
const withTrash = (project: Project, trash: readonly TrashedDocument[]): Project => {
  const { trash: _, ...rest } = project;
  return trash.length ? { ...rest, trash } : rest;
};
/** The settings a project's versions keep: what travels with it to other devices (not its trash or remote). */
const settingsText = (project: Project) => JSON.stringify({ name: project.name, parameters: project.parameters ?? [], ...notesOf(project) }, null, 2);

/** Media types of files kept as attachments, by extension. */
const attachmentTypes: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  step: 'model/step', stp: 'model/step', stl: 'model/stl', zip: 'application/zip',
};
const attachmentType = (name: string) => attachmentTypes[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
/** The largest file kept with a project. */
const maxAttachmentSize = 100 * 1024 * 1024;
const invalidRemote = () => fail({ code: 'invalid-remote', message: 'A remote is a git repository address starting with https:// (or http://).' });
const unknownLibrary = (library: string) => fail({ code: 'unknown-library', message: `No library ${library} on this device (list_libraries).` });
const unknownDocument = (id: DocumentId) =>
  fail({ code: 'unknown-document', message: `Document ${id} does not exist.` });

/** Next free "<Kind> n" name, one higher than the highest number in use. */
function defaultName(kind: DocumentKind, existing: readonly DocumentSummary[]): string {
  const label = kindLabels[kind];
  const pattern = new RegExp(`^${label} (\\d+)$`);
  const highest = existing.reduce((max, d) => Math.max(max, Number(pattern.exec(d.name)?.[1] ?? 0)), 0);
  return `${label} ${highest + 1}`;
}

const byKindThenName = (a: DocumentSummary, b: DocumentSummary) =>
  documentKinds.indexOf(a.kind) - documentKinds.indexOf(b.kind) || a.name.localeCompare(b.name);

export class DefaultProjectManager implements ProjectManager {
  /** Versions waiting to be recorded, by project. */
  private readonly pending = new Map<ProjectId, ReturnType<typeof setTimeout>>();
  /** One recording or sync at a time. */
  private recording: Promise<unknown> = Promise.resolve();
  /** Who follows what lists show (`watch`). */
  private readonly watchers = new Set<(change: StoreChange) => void>();

  constructor(private readonly deps: ProjectManagerDependencies) {
    deps.events.subscribe('documentSaved', ({ projectId }) => this.scheduleVersion(projectId));
    // What lists show: documents changed elsewhere (tabs, windows, processes: CAD-150), renamed, restored or deleted, and projects.
    const tell = (change: StoreChange) => this.watchers.forEach((listener) => listener(change));
    for (const event of ['documentChanged', 'documentRenamed', 'documentRestored'] as const) deps.events.subscribe(event, ({ documentId }) => tell({ kind: 'document', documentId }));
    deps.events.subscribe('documentDeleted', ({ documentId }) => tell({ kind: 'document', documentId, gone: true }));
    for (const event of ['projectDeleted', 'projectChanged', 'projectParametersChanged'] as const) deps.events.subscribe(event, ({ projectId }) => tell({ kind: 'projects', projectId }));
  }

  watch(listener: (change: StoreChange) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  /** Records a version once the project has been left alone for a moment. */
  private scheduleVersion(projectId: ProjectId): void {
    clearTimeout(this.pending.get(projectId));
    this.pending.set(
      projectId,
      setTimeout(() => {
        this.pending.delete(projectId);
        void this.recordVersion(projectId);
      }, this.deps.versionDelay ?? 3000),
    );
  }

  async recordVersion(id: ProjectId, message?: string): Promise<void> {
    // A new version of a library reaches the projects that follow it (CAD-151).
    if (await this.serially(() => this.record(id, message))) await this.followLibrary(id);
  }

  /** Runs after the recordings and syncs before it, so they never interleave. */
  private serially<T>(work: () => Promise<T>): Promise<T> {
    const run = this.recording.then(work);
    this.recording = run.catch(() => undefined);
    return run;
  }

  /** Records a version; answers whether it was a new version of a library. */
  private async record(id: ProjectId, message?: string): Promise<boolean> {
    const project = await this.deps.projects.find(id);
    if (!project) return false;
    const documents = await Promise.all((await this.deps.documents.enumerate(id)).map((d) => this.deps.documents.load(d.id)));
    const files: VersionFile[] = documents.flatMap((d) => (d ? [{ path: documentPath(d.id), text: versionText(d) }] : []));
    for (const document of documents) {
      if (document?.kind !== 'imported') continue;
      const { assetId } = document;
      files.push({ path: originalPath(assetId), bytes: async () => (await this.deps.assets.fetch(assetId))?.bytes ?? new Uint8Array() });
    }
    // Attached files are kept like originals (CAD-149).
    for (const attachment of project.attachments ?? []) {
      if (attachment.kind !== 'file') continue;
      const { assetId } = attachment;
      files.push({ path: originalPath(assetId), bytes: async () => (await this.deps.assets.fetch(assetId))?.bytes ?? new Uint8Array() });
    }
    files.push({ path: settingsPath, text: settingsText(project) });
    const summary = message ?? (await this.changes(id, files, documents.flatMap((d) => (d ? [d] : []))));
    const recorded = await this.deps.versions.record(id, files, summary, this.now());
    return recorded !== undefined && project.library !== undefined;
  }

  /** What changed since the latest version: documents added, changed or removed. */
  private async changes(id: ProjectId, files: readonly VersionFile[], documents: readonly CadDocument[]): Promise<string> {
    const [latest] = await this.deps.versions.versions(id);
    if (!latest) return 'First version';
    const changed: string[] = [];
    for (const document of documents) {
      const before = await this.deps.versions.read(id, latest.id, documentPath(document.id));
      const file = files.find((f) => f.path === documentPath(document.id));
      const now = file && 'text' in file ? file.text : undefined;
      if (before === undefined) changed.push(`Added ${document.name}`);
      else if (before !== now) changed.push(`Changed ${document.name}`);
    }
    return changed.join(', ') || 'Changed the project';
  }

  async projectHistory(id: ProjectId): Promise<Version[]> {
    return this.deps.versions.versions(id);
  }

  async documentHistory(id: DocumentId): Promise<Version[]> {
    const document = await this.deps.documents.load(id);
    if (!document) return [];
    // A copy's document also appears under the ids it had before it was copied (CAD-147).
    const earlier = (await this.deps.projects.find(document.projectId))?.copiedFrom?.[id] ?? [];
    const all = (await Promise.all([id, ...earlier].map((at) => this.deps.versions.versions(document.projectId, documentPath(at as DocumentId))))).flat();
    return [...new Map(all.map((v) => [v.id, v])).values()].sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
  }

  async restoreDocument(id: DocumentId, version: string): Promise<Result<void>> {
    const current = await this.deps.documents.load(id);
    if (!current) return fail({ code: 'unknown-document', message: `Document ${id} does not exist.` });
    const text = (await this.deps.versions.read(current.projectId, version, documentPath(id))) ?? (await this.fromBeforeTheCopy(current.projectId, id, version));
    if (text === undefined) return fail({ code: 'unknown-version', message: 'The document did not exist in that version.' });
    const restored = { ...(JSON.parse(text) as CadDocument), id, projectId: current.projectId, modifiedAt: this.now() } as CadDocument;
    await this.deps.documents.store(restored);
    const from = (await this.deps.versions.versions(current.projectId)).find((v) => v.id === version);
    await this.recordVersion(current.projectId, `Restored ${restored.name} from ${from?.names[0] ?? from?.time ?? version.slice(0, 7)}`);
    this.deps.events.publish('documentRestored', { documentId: id });
    return ok(undefined);
  }

  /** A copy's document as it was before the copy, under one of its earlier ids, with all earlier ids made the copy's (CAD-147). */
  private async fromBeforeTheCopy(projectId: ProjectId, id: DocumentId, version: string): Promise<string | undefined> {
    const copiedFrom = (await this.deps.projects.find(projectId))?.copiedFrom ?? {};
    for (const earlier of copiedFrom[id] ?? []) {
      const text = await this.deps.versions.read(projectId, version, documentPath(earlier as DocumentId));
      if (text === undefined) continue;
      const ids = new Map(Object.entries(copiedFrom).flatMap(([now, before]) => before.map((old) => [old, now] as const)));
      return remapIds(text, ids);
    }
    return undefined;
  }

  async nameVersion(id: ProjectId, name: string, version?: string): Promise<Result<void>> {
    if (!version) await this.recordVersion(id);
    const target = version ?? (await this.deps.versions.versions(id))[0]?.id;
    if (!target) return fail({ code: 'no-versions', message: 'The project has no versions yet.' });
    try {
      await this.deps.versions.name(id, target, name.trim());
      return ok(undefined);
    } catch (error) {
      if (error instanceof InvalidVersionNameError) return fail({ code: 'invalid-name', message: error.message });
      throw error;
    }
  }

  async unnameVersion(id: ProjectId, name: string): Promise<void> {
    await this.deps.versions.unname(id, name);
  }

  async setRemote(id: ProjectId, remote: ProjectRemote | undefined): Promise<Result<void>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    if (remote && !validRemote(remote)) return invalidRemote();
    const { remote: _, ...rest } = project;
    await this.deps.projects.revise(remote ? { ...rest, remote } : rest);
    return ok(undefined);
  }

  async syncProject(id: ProjectId, credentials?: RemoteCredentials, resolutions: Readonly<Record<string, ConflictChoice>> = {}): Promise<Result<SyncOutcome>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    const { remote } = project;
    if (!remote) return fail({ code: 'no-remote', message: 'The project is not shared with a git repository yet.' });
    return this.serially(async () => {
      await this.record(id);
      return this.exchange(id, remote, credentials, resolutions);
    });
  }

  async openRemoteProject(remote: ProjectRemote, credentials?: RemoteCredentials): Promise<Result<ProjectSummary>> {
    if (!validRemote(remote)) return invalidRemote();
    const now = this.now();
    // Named after the repository until its settings arrive.
    const name = /([^/]+?)(\.git)?\/*$/.exec(remote.url)?.[1] ?? 'Shared project';
    const project: Project = { id: asProjectId(this.deps.newId()), name, createdAt: now, modifiedAt: now, remote };
    await this.deps.projects.establish(project);
    const synced = await this.serially(() => this.exchange(project.id, remote, credentials, {}));
    if (!synced.ok) {
      await this.purgeProject(project.id);
      return synced;
    }
    return ok(await this.summarizeProject((await this.deps.projects.find(project.id)) ?? project));
  }

  /** Exchanges versions with the remote (see `syncProject`). */
  private async exchange(
    id: ProjectId,
    remote: ProjectRemote,
    credentials: RemoteCredentials | undefined,
    resolutions: Readonly<Record<string, ConflictChoice>>,
  ): Promise<Result<SyncOutcome>> {
    const { versions } = this.deps;
    try {
      const theirs = await versions.fetch(id, remote, credentials);
      const mine = await versions.latest(id);
      const common = mine && theirs ? await versions.commonVersion(id, mine, theirs) : undefined;
      let kind: 'up-to-date' | 'pushed' | 'pulled' | 'merged';
      if (theirs === mine) kind = 'up-to-date';
      else if (!theirs || common === theirs) {
        await versions.push(id, remote, credentials);
        kind = 'pushed';
      } else if (!mine || common === mine) {
        await versions.advance(id, theirs);
        await this.apply(id, theirs, mine);
        kind = 'pulled';
      } else {
        const merged = await this.merge(id, common, mine, theirs, resolutions);
        if ('conflicts' in merged) return ok({ kind: 'conflicts', conflicts: merged.conflicts });
        const version = (await versions.record(id, merged.files, `Merged the changes from ${remote.url}`, this.now(), theirs)) as string;
        await this.apply(id, version, mine);
        await versions.push(id, remote, credentials);
        kind = 'merged';
      }
      // Version names travel with the versions; the remote now has ours.
      const nameConflicts = mine || theirs ? await versions.syncNames(id, remote, credentials) : [];
      if (kind !== 'pulled' && kind !== 'up-to-date') await versions.fetch(id, remote, credentials);
      return ok(nameConflicts.length ? { kind, nameConflicts } : { kind });
    } catch (error) {
      if (error instanceof RemoteError) return fail({ code: `remote-${error.problem}`, message: error.message });
      throw error;
    }
  }

  /**
   * Combines two versions file by file against the version they share: a file changed on one side
   * takes that side; one changed on both needs a choice.
   */
  private async merge(
    id: ProjectId,
    common: string | undefined,
    mine: string,
    theirs: string,
    resolutions: Readonly<Record<string, ConflictChoice>>,
  ): Promise<{ files: VersionFile[] } | { conflicts: SyncConflict[] }> {
    const { versions } = this.deps;
    const paths = new Set([...(common ? await versions.files(id, common) : []), ...(await versions.files(id, mine)), ...(await versions.files(id, theirs))]);
    const files: VersionFile[] = [];
    const conflicts: SyncConflict[] = [];
    for (const path of [...paths].sort()) {
      const [base, ours, other] = await Promise.all([common, mine, theirs].map((v) => (v ? versions.readBytes(id, v, path) : undefined)));
      let kept: Uint8Array | undefined;
      if (sameBytes(ours, other) || sameBytes(other, base)) kept = ours;
      else if (sameBytes(ours, base)) kept = other;
      else if (resolutions[path]) kept = resolutions[path] === 'mine' ? ours : other;
      else {
        conflicts.push({ path, name: this.conflictName(path, ours ?? other) });
        continue;
      }
      if (!kept) continue;
      const bytes = kept;
      files.push(isOriginal(path) ? { path, bytes: async () => bytes } : { path, text: new TextDecoder().decode(bytes) });
    }
    return conflicts.length ? { conflicts } : { files };
  }

  private conflictName(path: string, bytes: Uint8Array | undefined): string {
    if (path === settingsPath) return 'Project settings';
    try {
      return (JSON.parse(new TextDecoder().decode(bytes)) as { name?: string }).name ?? path;
    } catch {
      return path;
    }
  }

  /**
   * Brings the project to a version's files: its settings, its documents and their originals.
   * Documents it no longer has go to the trash, as `previous` had them.
   */
  private async apply(id: ProjectId, version: string, previous?: string): Promise<void> {
    const { versions, documents, assets, events } = this.deps;
    const project = await this.deps.projects.find(id);
    if (!project) return;
    const settings = await versions.read(id, version, settingsPath);
    if (settings) {
      const { name, parameters, ...notes } = JSON.parse(settings) as Pick<Project, 'name' | 'parameters' | 'description' | 'attachments' | 'library'>;
      const { description: _d, attachments: _a, library: _l, ...rest } = project;
      for (const attachment of notes.attachments ?? []) {
        if (attachment.kind !== 'file' || (await assets.fetch(attachment.assetId))) continue;
        const bytes = await versions.readBytes(id, version, originalPath(attachment.assetId));
        if (bytes) await assets.keep({ id: attachment.assetId, projectId: id, name: attachment.name, byteLength: bytes.length, bytes });
      }
      await this.deps.projects.revise({ ...rest, name, parameters: parameters ?? [], ...notesOf(notes), modifiedAt: this.now() });
      if (JSON.stringify(parameters ?? []) !== JSON.stringify(project.parameters ?? [])) events.publish('projectParametersChanged', { projectId: id });
      events.publish('projectChanged', { projectId: id });
    }
    const kept = new Set<string>();
    for (const path of await versions.files(id, version)) {
      if (!documentPattern.test(path)) continue;
      const text = (await versions.read(id, version, path)) as string;
      const document = { ...(JSON.parse(text) as CadDocument), projectId: id } as CadDocument;
      kept.add(document.id);
      const current = await documents.load(document.id);
      if (current && versionText(current) === text) continue;
      if (document.kind === 'imported' && !(await assets.fetch(document.assetId))) {
        const bytes = await versions.readBytes(id, version, originalPath(document.assetId));
        if (bytes) await assets.keep({ id: document.assetId, projectId: id, name: document.fileName, byteLength: bytes.length, bytes });
      }
      await documents.store(document);
      events.publish('documentRestored', { documentId: document.id });
    }
    const gone = (await documents.enumerate(id)).filter((d) => !kept.has(d.id));
    for (const document of gone) await this.discardDocument(document.id);
    const now = await this.deps.projects.find(id);
    if (now && previous && gone.length) {
      const trashedAt = this.now();
      const trashed = gone.map(({ id: documentId, name, kind }): TrashedDocument => ({ id: documentId, name, kind, trashedAt, version: previous }));
      await this.deps.projects.revise(withTrash(now, [...(now.trash ?? []).filter((t) => !kept.has(t.id) && !gone.some((g) => g.id === t.id)), ...trashed]));
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    await this.purgeExpired();
    const projects = (await this.deps.projects.enumerate()).filter((p) => !p.trashedAt);
    const summaries = await Promise.all(projects.map((p) => this.summarizeProject(p)));
    return summaries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async findProject(id: ProjectId): Promise<ProjectSummary | undefined> {
    const project = await this.deps.projects.find(id);
    // A project in the trash is not found until it is restored.
    return project && !project.trashedAt ? this.summarizeProject(project) : undefined;
  }

  async createProject(name: string): Promise<Result<CreatedProject>> {
    const valid = validName(name);
    if (!valid.ok) return valid;
    const now = this.now();
    const project: Project = { id: asProjectId(this.deps.newId()), name: valid.value, createdAt: now, modifiedAt: now };
    await this.deps.projects.establish(project);
    const firstDocument = await this.storeNewDocument(project.id, 'component', defaultName('component', []));
    return ok({ project: await this.summarizeProject(project), firstDocument });
  }

  async renameProject(id: ProjectId, name: string): Promise<Result<void>> {
    const valid = validName(name);
    if (!valid.ok) return valid;
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    await this.deps.projects.revise({ ...project, name: valid.value, modifiedAt: this.now() });
    return ok(undefined);
  }

  async setProjectParameters(id: ProjectId, parameters: readonly Parameter[]): Promise<Result<void>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    const evaluated = this.deps.parameters.evaluateAll(parameters);
    if (!evaluated.ok) return evaluated;
    await this.deps.projects.revise({ ...project, parameters, modifiedAt: this.now() });
    this.deps.events.publish('projectParametersChanged', { projectId: id });
    return ok(undefined);
  }

  async deleteProject(id: ProjectId): Promise<void> {
    const project = await this.deps.projects.find(id);
    if (!project || project.trashedAt) return;
    // It stays as it is, documents and history, until it is restored or deleted for good (CAD-148).
    await this.deps.projects.revise({ ...project, trashedAt: this.now() });
    this.deps.events.publish('projectDeleted', { projectId: id });
  }

  /** Deletes a project for good: its documents, assets and history. */
  private async purgeProject(id: ProjectId): Promise<void> {
    for (const document of await this.deps.documents.enumerate(id)) {
      await this.discardDocument(document.id);
    }
    await this.deps.projects.discard(id);
    clearTimeout(this.pending.get(id));
    await this.deps.versions.discard(id);
    this.deps.events.publish('projectDeleted', { projectId: id });
  }

  async listDocuments(projectId: ProjectId): Promise<DocumentSummary[]> {
    return (await this.deps.documents.enumerate(projectId)).sort(byKindThenName);
  }

  async findDocument(id: DocumentId): Promise<DocumentSummary | undefined> {
    const document = await this.deps.documents.load(id);
    return document && summarize(document);
  }

  async createDocument(
    projectId: ProjectId,
    kind: CreatableDocumentKind,
    name?: string,
  ): Promise<Result<DocumentSummary>> {
    if (!(await this.deps.projects.find(projectId))) return unknownProject(projectId);
    let finalName: string;
    if (name === undefined) {
      finalName = defaultName(kind, await this.deps.documents.enumerate(projectId));
    } else {
      const valid = validName(name);
      if (!valid.ok) return valid;
      finalName = valid.value;
    }
    const document = await this.storeNewDocument(projectId, kind, finalName);
    await this.touchProject(projectId);
    return ok(document);
  }

  async renameDocument(id: DocumentId, name: string): Promise<Result<void>> {
    const valid = validName(name);
    if (!valid.ok) return valid;
    const document = await this.deps.documents.load(id);
    if (!document) return unknownDocument(id);
    await this.deps.documents.store({ ...document, name: valid.value, modifiedAt: this.now() });
    await this.touchProject(document.projectId);
    this.deps.events.publish('documentRenamed', { documentId: id, name: valid.value });
    return ok(undefined);
  }

  async deleteDocument(id: DocumentId): Promise<void> {
    const document = await this.deps.documents.load(id);
    if (!document) return;
    // Its last state goes into the history first: the trash brings it back from there (CAD-148).
    await this.recordVersion(document.projectId);
    const version = await this.deps.versions.latest(document.projectId);
    await this.discardDocument(id);
    const project = await this.deps.projects.find(document.projectId);
    if (project && version) {
      const entry: TrashedDocument = { id, name: document.name, kind: document.kind, trashedAt: this.now(), version };
      await this.deps.projects.revise(withTrash(project, [...(project.trash ?? []).filter((t) => t.id !== id), entry]));
    }
    await this.touchProject(document.projectId);
  }

  async listTrash(): Promise<TrashItem[]> {
    await this.purgeExpired();
    const items: TrashItem[] = [];
    for (const project of await this.deps.projects.enumerate()) {
      if (project.trashedAt) {
        const documentCount = (await this.deps.documents.enumerate(project.id)).length;
        items.push({ kind: 'project', id: project.id, name: project.name, trashedAt: project.trashedAt, expiresAt: expiry(project.trashedAt), documentCount });
        continue;
      }
      for (const entry of project.trash ?? []) {
        const { id, name, kind: documentKind, trashedAt } = entry;
        items.push({ kind: 'document', id, name, documentKind, projectId: project.id, projectName: project.name, trashedAt, expiresAt: expiry(trashedAt) });
      }
    }
    return items.sort((a, b) => b.trashedAt.localeCompare(a.trashedAt));
  }

  async restoreFromTrash(id: ProjectId | DocumentId): Promise<Result<TrashItem>> {
    const item = (await this.listTrash()).find((i) => i.id === id);
    if (!item) return notInTrash(id);
    const project = await this.deps.projects.find(item.kind === 'project' ? item.id : item.projectId);
    if (!project) return notInTrash(id);
    if (item.kind === 'project') {
      const { trashedAt: _, ...rest } = project;
      await this.deps.projects.revise({ ...rest, modifiedAt: this.now() });
      this.deps.events.publish('projectChanged', { projectId: project.id });
      return ok(item);
    }
    const entry = project.trash?.find((t) => t.id === id) as TrashedDocument;
    const text = await this.deps.versions.read(project.id, entry.version, documentPath(entry.id));
    if (text === undefined) return fail({ code: 'lost', message: `The history of ${project.name} no longer has ${entry.name}.` });
    const document = { ...(JSON.parse(text) as CadDocument), id: entry.id, projectId: project.id, modifiedAt: this.now() } as CadDocument;
    if (document.kind === 'imported' && !(await this.deps.assets.fetch(document.assetId))) {
      const bytes = await this.deps.versions.readBytes(project.id, entry.version, originalPath(document.assetId));
      if (bytes) await this.deps.assets.keep({ id: document.assetId, projectId: project.id, name: document.fileName, byteLength: bytes.length, bytes });
    }
    await this.deps.documents.store(document);
    await this.deps.projects.revise(withTrash({ ...project, modifiedAt: this.now() }, (project.trash ?? []).filter((t) => t.id !== id)));
    await this.recordVersion(project.id, `Restored ${document.name} from the trash`);
    this.deps.events.publish('documentRestored', { documentId: document.id });
    return ok(item);
  }

  async deleteFromTrash(id: ProjectId | DocumentId): Promise<Result<void>> {
    for (const project of await this.deps.projects.enumerate()) {
      if (project.id === id && project.trashedAt) {
        await this.purgeProject(project.id);
        return ok(undefined);
      }
      if (project.trash?.some((t) => t.id === id)) {
        // Earlier versions stay in the project's history, as for every change.
        await this.deps.projects.revise(withTrash(project, project.trash.filter((t) => t.id !== id)));
        return ok(undefined);
      }
    }
    return notInTrash(id);
  }

  async emptyTrash(): Promise<void> {
    await this.purgeExpired(Infinity);
  }

  /** Deletes for good what has been in the trash longer than `days`. */
  private async purgeExpired(days = trashDays): Promise<void> {
    const limit = this.deps.clock().getTime() - days * day;
    const expired = (time: string) => !Number.isFinite(limit) || Date.parse(time) <= limit;
    for (const project of await this.deps.projects.enumerate()) {
      if (project.trashedAt && expired(project.trashedAt)) {
        await this.purgeProject(project.id);
        continue;
      }
      const kept = (project.trash ?? []).filter((t) => !expired(t.trashedAt));
      if (kept.length !== (project.trash?.length ?? 0)) await this.deps.projects.revise(withTrash(project, kept));
    }
  }

  async setProjectDescription(id: ProjectId, description: string): Promise<Result<void>> {
    return this.reviseProject(id, (project) => {
      const { description: _, ...rest } = project;
      return description.trim() ? { ...rest, description } : rest;
    });
  }

  async addAttachment(id: ProjectId, input: AttachmentInput): Promise<Result<Attachment>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    const addedAt = this.now();
    let attachment: Attachment;
    if ('link' in input) {
      const url = input.link.url.trim();
      if (!/^(https?:\/\/[^\s/]+|mailto:\S+@)\S*$/.test(url)) return fail({ code: 'invalid-link', message: 'A link starts with https://, http:// or mailto:.' });
      attachment = { id: this.deps.newId(), kind: 'link', name: input.link.name?.trim().slice(0, maxNameLength) || url, url, addedAt };
    } else {
      const { name, bytes } = input.file;
      if (!name.trim()) return fail({ code: 'invalid-name', message: 'An attached file needs a name.' });
      if (bytes.byteLength > maxAttachmentSize) return fail({ code: 'too-large', message: `Files up to ${maxAttachmentSize / 1024 / 1024} MB can be attached.` });
      const assetId = asAssetId(this.deps.newId());
      await this.deps.assets.keep({ id: assetId, projectId: id, name, byteLength: bytes.byteLength, bytes });
      attachment = { id: this.deps.newId(), kind: 'file', name: name.trim(), mediaType: attachmentType(name), byteLength: bytes.byteLength, assetId, addedAt };
    }
    const revised = await this.reviseProject(id, (p) => ({ ...p, attachments: [...(p.attachments ?? []), attachment] }));
    return revised.ok ? ok(attachment) : revised;
  }

  async removeAttachment(id: ProjectId, attachmentId: string): Promise<Result<void>> {
    const project = await this.deps.projects.find(id);
    const attachment = project?.attachments?.find((a) => a.id === attachmentId);
    if (!project) return unknownProject(id);
    if (!attachment) return fail({ code: 'unknown-attachment', message: `${project.name} has no attachment ${attachmentId}.` });
    if (attachment.kind === 'file') await this.deps.assets.release(attachment.assetId);
    return this.reviseProject(id, (p) => {
      const { attachments: _, ...rest } = p;
      const kept = (p.attachments ?? []).filter((a) => a.id !== attachmentId);
      return kept.length ? { ...rest, attachments: kept } : rest;
    });
  }

  async attachmentFile(id: ProjectId, attachmentId: string): Promise<Result<{ readonly attachment: Attachment; readonly bytes: Uint8Array }>> {
    const project = await this.deps.projects.find(id);
    const attachment = project?.attachments?.find((a) => a.id === attachmentId);
    if (attachment?.kind !== 'file') return fail({ code: 'unknown-attachment', message: `No attached file ${attachmentId}.` });
    const asset = await this.deps.assets.fetch(attachment.assetId);
    if (!asset) return fail({ code: 'missing-original', message: `The file of ${attachment.name} is missing.` });
    return ok({ attachment, bytes: asset.bytes });
  }

  /** Changes a project's record; its version follows a few seconds later. */
  private async reviseProject(id: ProjectId, change: (project: Project) => Project): Promise<Result<void>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    await this.deps.projects.revise({ ...change(project), modifiedAt: this.now() });
    this.scheduleVersion(id);
    this.deps.events.publish('projectChanged', { projectId: id });
    return ok(undefined);
  }

  async setLibrary(id: ProjectId, library: boolean): Promise<Result<void>> {
    return this.reviseProject(id, (project) => {
      const { library: _, ...rest } = project;
      return library ? { ...rest, library: project.library ?? { id: this.deps.newId() } } : rest;
    });
  }

  async listLibraries(): Promise<LibrarySummary[]> {
    const libraries: LibrarySummary[] = [{ id: standardLibraryId, name: standardLibraryName, partCount: standardParts.length }];
    for (const project of (await this.deps.projects.enumerate()).filter((p) => p.library && !p.trashedAt).sort((a, b) => a.name.localeCompare(b.name))) {
      const parts = (await this.deps.documents.enumerate(project.id)).filter((d) => d.kind === 'component' && !d.library);
      libraries.push({ id: (project.library as { id: string }).id, name: project.name, projectId: project.id, partCount: parts.length });
    }
    return libraries;
  }

  async libraryParts(library: string): Promise<Result<LibraryPart[]>> {
    if (library === standardLibraryId) return ok(standardLibraryParts());
    const project = await this.libraryProject(library);
    if (!project) return unknownLibrary(library);
    const parts = (await this.listDocuments(project.id)).filter((d) => d.kind === 'component' && !d.library);
    return ok(parts.map(({ id, name }) => ({ id, name })));
  }

  async useLibraryPart(projectId: ProjectId, library: string, part: string, options: { readonly follow?: LibraryLink['follow'] } = {}): Promise<Result<DocumentSummary>> {
    const project = await this.deps.projects.find(projectId);
    if (!project || project.trashedAt) return unknownProject(projectId);
    const mine = await this.loadAll(projectId);
    if (library === standardLibraryId) {
      const standard = findStandardPart(part);
      if (!standard) return fail({ code: 'unknown-part', message: `The standard parts have no ${part}; they are named like ISO 4762 M3 × 12 or screw-M3-12.` });
      const taken = mine.find((d) => d.library?.library === standardLibraryId && d.library.document === standard.key);
      if (taken) return ok(summarize(taken));
      const document = standardComponent(standard, projectId, this.deps.newId(), this.now());
      await this.deps.documents.store(document);
      await this.touchProject(projectId);
      return ok(summarize(document));
    }
    const source = await this.libraryProject(library);
    if (!source) return unknownLibrary(library);
    if (source.id === projectId) return fail({ code: 'same-project', message: `${source.name} is this project: its assemblies insert its components directly.` });
    const parts = await this.loadAll(source.id);
    const component = parts.find((d) => d.kind === 'component' && !d.library && (d.id === part || d.name === part));
    if (!component) return fail({ code: 'unknown-part', message: `The library ${source.name} has no component ${part}.` });
    // Taken before: the project keeps the version it took (an update brings a newer one).
    const taken = mine.find((d) => d.kind === 'component' && d.library?.library === library && d.library.document === component.id);
    if (taken) return ok(summarize(taken));
    await this.recordVersion(source.id);
    const version = (await this.deps.versions.latest(source.id)) ?? 'none';
    return ok(await this.take(projectId, source, component, parts, mine, version, options.follow ?? 'asked'));
  }

  async libraryUpdates(projectId: ProjectId): Promise<LibraryUpdate[]> {
    const parts = (await this.deps.documents.enumerate(projectId)).filter((d) => d.kind === 'component' && d.library && d.library.library !== standardLibraryId);
    const updates: LibraryUpdate[] = [];
    for (const library of new Set(parts.map((d) => (d.library as LibraryLink).library))) {
      const source = await this.libraryProject(library);
      if (!source) continue;
      await this.recordVersion(source.id);
      const latest = await this.deps.versions.latest(source.id);
      if (!latest) continue;
      for (const document of parts.filter((d) => d.library?.library === library)) {
        const link = document.library as LibraryLink;
        if (link.version !== latest && (await this.changedBetween(source.id, link.document, link.version, latest))) updates.push({ document, link, latest });
      }
    }
    return updates;
  }

  async updateLibraryParts(projectId: ProjectId, documents?: readonly DocumentId[]): Promise<Result<DocumentSummary[]>> {
    if (!(await this.deps.projects.find(projectId))) return unknownProject(projectId);
    const updates = (await this.libraryUpdates(projectId)).filter((u) => !documents || documents.includes(u.document.id));
    const updated: DocumentSummary[] = [];
    for (const update of updates) {
      const source = await this.libraryProject(update.link.library);
      const parts = source ? await this.loadAll(source.id) : [];
      const part = parts.find((d) => d.id === update.link.document);
      // A part the library no longer has stays as it is.
      if (!source || !part) continue;
      updated.push(await this.take(projectId, source, part, parts, await this.loadAll(projectId), update.latest, update.link.follow));
    }
    return ok(updated);
  }

  async setLibraryFollow(id: DocumentId, follow: LibraryLink['follow']): Promise<Result<void>> {
    const document = await this.deps.documents.load(id);
    if (!document) return unknownDocument(id);
    if (!document.library) return fail({ code: 'not-a-library-part', message: `${document.name} is not from a library.` });
    await this.deps.documents.store({ ...document, library: { ...document.library, follow } });
    await this.touchProject(document.projectId);
    return ok(undefined);
  }

  /** Brings a library's new version to the projects whose parts of it follow it (`follow: 'always'`). */
  private async followLibrary(id: ProjectId): Promise<void> {
    const source = await this.deps.projects.find(id);
    const library = source?.library?.id;
    const latest = await this.deps.versions.latest(id);
    if (!source || !library || source.trashedAt || !latest) return;
    for (const project of await this.deps.projects.enumerate()) {
      if (project.id === id || project.trashedAt) continue;
      const followers = (await this.deps.documents.enumerate(project.id)).filter((d) => d.kind === 'component' && d.library?.library === library && d.library.follow === 'always' && d.library.version !== latest);
      if (!followers.length) continue;
      const parts = await this.loadAll(id);
      for (const follower of followers) {
        const link = follower.library as LibraryLink;
        const part = parts.find((d) => d.id === link.document);
        if (part && (await this.changedBetween(id, part.id, link.version, latest))) await this.take(project.id, source, part, parts, await this.loadAll(project.id), latest, 'always');
      }
    }
  }

  /** Whether a library's part (or the project parameters it uses) differs between two of its versions. */
  private async changedBetween(library: ProjectId, part: string, from: string, to: string): Promise<boolean> {
    const read = (version: string) => Promise.all([documentPath(part as DocumentId), settingsPath].map((path) => this.deps.versions.read(library, version, path)));
    const [[partBefore, settingsBefore], [partNow, settingsNow]] = await Promise.all([read(from), read(to)]);
    const parameters = (settings: string | undefined) => JSON.stringify(settings ? (JSON.parse(settings) as Project).parameters ?? [] : []);
    return partBefore !== partNow || parameters(settingsBefore) !== parameters(settingsNow);
  }

  /** Stores a library part (and what it uses) in a project, as the library's version `version` has it. */
  private async take(projectId: ProjectId, source: Project, part: CadDocument, parts: readonly CadDocument[], mine: readonly CadDocument[], version: string, follow: LibraryLink['follow']): Promise<DocumentSummary> {
    const library = (source.library as { id: string }).id;
    const taken = mine.filter((d) => d.library?.library === library);
    const link = { library, libraryName: source.name, version, follow };
    const copies = libraryCopies({ part, library: parts, parameters: source.parameters ?? [], link, taken, projectId, now: this.now(), newId: this.deps.newId });
    for (const [asset, theirs] of copies.originals) {
      const bytes = (await this.deps.assets.fetch(asAssetId(theirs)))?.bytes;
      const owner = copies.documents.find((d) => d.kind === 'imported' && d.assetId === asset);
      if (bytes && owner?.kind === 'imported') await this.deps.assets.keep({ id: asAssetId(asset), projectId, name: owner.fileName, byteLength: bytes.length, bytes });
    }
    for (const document of copies.documents) {
      await this.deps.documents.store(document);
      // Open assemblies and drawings of an earlier version read it again.
      if (taken.some((d) => d.id === document.id)) {
        if (document.kind === 'component') await this.deps.assets.discardResult(document.id);
        this.deps.events.publish('documentRestored', { documentId: document.id });
      }
    }
    await this.touchProject(projectId);
    return summarize(copies.documents[0] as CadDocument);
  }

  /** The project holding a library here (not in the trash). */
  private async libraryProject(library: string): Promise<Project | undefined> {
    return (await this.deps.projects.enumerate()).find((p) => p.library?.id === library && !p.trashedAt);
  }

  /** A project's documents, loaded. */
  private async loadAll(projectId: ProjectId): Promise<CadDocument[]> {
    return (await Promise.all((await this.deps.documents.enumerate(projectId)).map((d) => this.deps.documents.load(d.id)))).filter((d): d is CadDocument => d !== undefined);
  }

  async importFile(projectId: ProjectId, file: ExternalFile): Promise<Result<DocumentSummary>> {
    if (!(await this.deps.projects.find(projectId))) return unknownProject(projectId);
    const dot = file.name.lastIndexOf('.');
    const format = formatOf(file.name);
    if (!format) {
      return fail({
        code: 'unsupported-format',
        message: `CADence imports ${Object.keys(formatsByExtension).join(', ')} files.`,
      });
    }
    const name = validName(file.name.slice(0, dot));
    const assetId = asAssetId(this.deps.newId());
    await this.deps.assets.keep({
      id: assetId,
      projectId,
      name: file.name,
      byteLength: file.bytes.byteLength,
      bytes: file.bytes,
    });
    const now = this.now();
    const document: CadDocument = {
      id: asDocumentId(this.deps.newId()),
      projectId,
      kind: 'imported',
      name: name.ok ? name.value : 'Imported file',
      createdAt: now,
      modifiedAt: now,
      schemaVersion: currentSchemaVersion,
      assetId,
      format,
      fileName: file.name,
      byteLength: file.bytes.byteLength,
    };
    await this.deps.documents.store(document);
    await this.touchProject(projectId);
    return ok(summarize(document));
  }

  async replaceImported(id: DocumentId, file: ExternalFile): Promise<Result<void>> {
    const document = await this.deps.documents.load(id);
    if (document?.kind !== 'imported') return fail({ code: 'unknown-document', message: `Imported file ${id} does not exist.` });
    const format = formatOf(file.name);
    if (!format || isDrawing(format) !== isDrawing(document.format)) {
      return fail({ code: 'unsupported-format', message: isDrawing(document.format) ? 'Replace a drawing by a DXF or SVG file.' : 'Replace a 3D file by a STEP, STL, OBJ or 3MF file.' });
    }
    const assetId = asAssetId(this.deps.newId());
    await this.deps.assets.keep({ id: assetId, projectId: document.projectId, name: file.name, byteLength: file.bytes.byteLength, bytes: file.bytes });
    await this.deps.documents.store({ ...document, assetId, format, fileName: file.name, byteLength: file.bytes.byteLength, modifiedAt: this.now() });
    await this.deps.assets.release(document.assetId);
    await this.touchProject(document.projectId);
    // What uses the file regenerates: components lose their results, and open assemblies reload.
    for (const summary of await this.deps.documents.enumerate(document.projectId)) {
      if (summary.id === id) continue;
      const user = await this.deps.documents.load(summary.id);
      if (!user || !JSON.stringify(user).includes(`"${id}"`)) continue;
      if (user.kind === 'component') await this.deps.assets.discardResult(user.id);
      this.deps.events.publish('documentRestored', { documentId: user.id });
    }
    this.deps.events.publish('documentRestored', { documentId: id });
    return ok(undefined);
  }

  async duplicateProject(id: ProjectId): Promise<Result<ProjectSummary>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    // The copy takes the history with it (CAD-147).
    const { bundle, ids } = copyOf(await this.bundleOf(project), this.deps.newId);
    const history = await this.deps.versions.exportHistory(id);
    // A copy of a library is a library of its own.
    const library = bundle.library ? { library: { id: this.deps.newId() } } : {};
    const copy = await this.createFromBundle({ ...bundle, ...library, name: copyName(project.name) }, history.length ? copiedFrom(ids, project.copiedFrom) : undefined);
    if (history.length) await this.deps.versions.importHistory(copy.id, history);
    await this.recordVersion(copy.id, `Duplicated from ${project.name}`);
    return ok(await this.summarizeProject(copy));
  }

  async duplicateDocument(id: DocumentId): Promise<Result<DocumentSummary>> {
    const document = await this.deps.documents.load(id);
    if (!document) return unknownDocument(id);
    const original = document.kind === 'imported' ? (await this.deps.assets.fetch(document.assetId))?.bytes : undefined;
    const bundle = withNewIds(
      { name: '', parameters: [], documents: [document], originals: new Map(document.kind === 'imported' && original ? [[document.assetId, original]] : []) },
      this.deps.newId,
    );
    const now = this.now();
    const copy = { ...(bundle.documents[0] as CadDocument), name: copyName(document.name), createdAt: now, modifiedAt: now };
    await this.keepOriginals(document.projectId, [copy], bundle.originals);
    await this.deps.documents.store(copy);
    await this.touchProject(document.projectId);
    return ok(summarize(copy));
  }

  async exportProject(id: ProjectId, options: { readonly history?: boolean; readonly libraries?: boolean } = {}): Promise<Result<void>> {
    const project = await this.deps.projects.find(id);
    if (!project) return unknownProject(id);
    const bytes = zip([...(await this.archiveOf(project, options.history)), ...(options.libraries ? await this.librariesOf(project) : [])]);
    await this.deps.externalFiles.deliver({ name: `${project.name}.cadence`, mediaType: 'application/zip', bytes });
    return ok(undefined);
  }

  /** A project's archive files, with its history if asked. */
  private async archiveOf(project: Project, history?: boolean): Promise<{ name: string; bytes: Uint8Array }[]> {
    if (history) await this.recordVersion(project.id);
    return archiveFiles(await this.bundleOf(project), history ? await this.deps.versions.exportHistory(project.id) : []);
  }

  /** The libraries a project uses, each an archive of its own inside the project's (`libraries/<id>.cadence`). */
  private async librariesOf(project: Project): Promise<{ name: string; bytes: Uint8Array }[]> {
    const used = new Set((await this.deps.documents.enumerate(project.id)).flatMap((d) => (d.library && d.library.library !== standardLibraryId ? [d.library.library] : [])));
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const library of used) {
      const source = await this.libraryProject(library);
      if (source) files.push({ name: `libraries/${library}.cadence`, bytes: zip(await this.archiveOf(source, true)) });
    }
    return files;
  }

  async importProject(file: ExternalFile): Promise<Result<ProjectSummary>> {
    const notArchive = fail({ code: 'not-an-archive', message: `${file.name} is not a CADence project archive.` });
    let archive: ReturnType<typeof readArchive>;
    let files: ReadonlyMap<string, Uint8Array>;
    try {
      files = await readZip(file.bytes);
      archive = readArchive(files);
    } catch {
      return notArchive;
    }
    if (!archive) return notArchive;
    // Libraries it brings along that this device does not have become projects too (CAD-151).
    for (const [path, bytes] of files) {
      const library = /^libraries\/(.+)\.cadence$/.exec(path)?.[1];
      if (library && !(await this.libraryProject(library))) await this.importProject({ name: `${library}.cadence`, bytes });
    }
    // Documents keep their ids unless this device has them already: then the project is a copy,
    // which keeps the history too, knowing the ids its documents had there (CAD-147).
    const taken = (await Promise.all(archive.bundle.documents.map((d) => this.deps.documents.load(d.id)))).some(Boolean);
    const copied = taken ? copyOf(archive.bundle, this.deps.newId) : undefined;
    // A copy of a library beside its original is a library of its own.
    if (copied?.bundle.library) Object.assign(copied, { bundle: { ...copied.bundle, library: { id: this.deps.newId() } } });
    const project = await this.createFromBundle(copied?.bundle ?? archive.bundle, copied && archive.history.length ? copiedFrom(copied.ids, archive.bundle.copiedFrom) : archive.bundle.copiedFrom);
    if (archive.history.length) await this.deps.versions.importHistory(project.id, archive.history);
    if (copied || !archive.history.length) await this.recordVersion(project.id, copied ? `Imported from ${file.name} as a copy` : `Imported from ${file.name}`);
    return ok(await this.summarizeProject(project));
  }

  async createFromTemplate(template: ProjectTemplate): Promise<Result<CreatedProject>> {
    const project = await this.createFromBundle(withNewIds(templateBundle(template), this.deps.newId));
    await this.recordVersion(project.id, `Created from the template ${template.name}`);
    const documents = await this.listDocuments(project.id);
    const firstDocument = documents.find((d) => d.kind === 'component') ?? documents[0];
    if (!firstDocument) return fail({ code: 'empty-template', message: `The template ${template.name} has no documents.` });
    return ok({ project: await this.summarizeProject(project), firstDocument });
  }

  /** The project's content, with the originals of its imported documents. */
  private async bundleOf(project: Project): Promise<ProjectBundle> {
    const documents = (await Promise.all((await this.deps.documents.enumerate(project.id)).map((d) => this.deps.documents.load(d.id)))).filter(
      (d): d is CadDocument => d !== undefined,
    );
    const originals = new Map<string, Uint8Array>();
    for (const document of documents) {
      if (document.kind !== 'imported') continue;
      const asset = await this.deps.assets.fetch(document.assetId);
      if (asset) originals.set(document.assetId, asset.bytes);
    }
    for (const attachment of project.attachments ?? []) {
      const asset = attachment.kind === 'file' ? await this.deps.assets.fetch(attachment.assetId) : undefined;
      if (attachment.kind === 'file' && asset) originals.set(attachment.assetId, asset.bytes);
    }
    return { name: project.name, parameters: project.parameters ?? [], documents, originals, ...(project.copiedFrom ? { copiedFrom: project.copiedFrom } : {}), ...notesOf(project) };
  }

  /** A new project holding the bundle's documents and originals as they are (ids included). */
  private async createFromBundle(bundle: ProjectBundle, copied?: Project['copiedFrom']): Promise<Project> {
    const now = this.now();
    const project: Project = {
      id: asProjectId(this.deps.newId()),
      name: validName(bundle.name).ok ? bundle.name.trim() : 'Untitled project',
      createdAt: now,
      modifiedAt: now,
      parameters: bundle.parameters,
      ...(copied ? { copiedFrom: copied } : {}),
      ...notesOf(bundle),
    };
    await this.deps.projects.establish(project);
    const documents = bundle.documents.map((d) => ({ ...d, projectId: project.id }) as CadDocument);
    await this.keepOriginals(project.id, documents, bundle.originals);
    for (const attachment of bundle.attachments ?? []) {
      const bytes = attachment.kind === 'file' ? bundle.originals.get(attachment.assetId) : undefined;
      if (attachment.kind === 'file' && bytes) await this.deps.assets.keep({ id: attachment.assetId, projectId: project.id, name: attachment.name, byteLength: bytes.byteLength, bytes });
    }
    for (const document of documents) await this.deps.documents.store(document);
    return project;
  }

  private async keepOriginals(projectId: ProjectId, documents: readonly CadDocument[], originals: ReadonlyMap<string, Uint8Array>): Promise<void> {
    for (const document of documents) {
      const bytes = document.kind === 'imported' ? originals.get(document.assetId) : undefined;
      if (document.kind !== 'imported' || !bytes) continue;
      await this.deps.assets.keep({ id: document.assetId, projectId, name: document.fileName, byteLength: bytes.byteLength, bytes });
    }
  }

  async openImported(id: DocumentId): Promise<ImportedView | undefined> {
    const document = await this.deps.documents.load(id);
    if (document?.kind !== 'imported') return undefined;
    const { format, fileName, byteLength } = document;
    return { document: summarize(document), format, fileName, byteLength };
  }

  async previewImported(id: DocumentId): Promise<Result<ImportedContent>> {
    const original = await this.original(id);
    if (!original.ok) return original;
    const { document, bytes } = original.value;
    if (document.format === 'dxf' || document.format === 'svg') {
      const drawing = await this.deps.interchange.readDrawing(bytes, document.format, 'i');
      if (!drawing.ok) return drawing;
      // The extent of the curves' points and of the texts' outlines.
      const outlinePoints = [...drawing.value.texts.values()].flat(2).flatMap((e) => [e.start, e.end]);
      const points = [...drawing.value.entities.flatMap((e) => (e.kind === 'point' ? [[e.x, e.y]] : [])), ...outlinePoints];
      const extent = (pick: (v: number[]) => number) => (points.length ? pick(points.map((p) => p[0] as number)) : 0);
      const extentY = (pick: (v: number[]) => number) => (points.length ? pick(points.map((p) => p[1] as number)) : 0);
      return ok({
        kind: 'drawing',
        entities: drawing.value.entities,
        texts: drawing.value.texts,
        min: [extent((v) => range(v)[0]), extentY((v) => range(v)[0]), 0],
        max: [extent((v) => range(v)[1]), extentY((v) => range(v)[1]), 0],
      });
    }
    if (isFontFormat(document.format)) {
      // A sample of the font, as a drawing.
      const font = await loadFont(bytes.slice().buffer);
      const sample = 'AaBbCc 0123 ÄÖÜ';
      const contours = font.outline(sample, { at: [0, 0], height: 10, angle: 0 });
      const points = contours.flat().flatMap((edge) => [edge.start, edge.end]);
      const extent = (axis: 0 | 1, pick: (...v: number[]) => number) => (points.length ? pick(...points.map((p) => p[axis])) : 0);
      return ok({
        kind: 'drawing',
        entities: [
          { id: 'a', kind: 'point', x: 0, y: 0 },
          { id: 't', kind: 'text', anchor: 'a', text: sample, height: 10, weight: 'regular', angle: 0, construction: false, font: id },
        ],
        texts: new Map([['t', contours.map((contour) => contour.map((edge) => ({ ...edge, source: 't' })))]]),
        min: [extent(0, Math.min), extent(1, Math.min), 0],
        max: [extent(0, Math.max), extent(1, Math.max), 0],
      });
    }
    if (!isModelFormat(document.format)) {
      const size = pictureSize(bytes);
      if (!size) return fail({ code: 'unreadable', message: `${document.fileName} is not a PNG or JPEG picture.` });
      return ok({ kind: 'picture', width: size.width, height: size.height, mediaType: size.mediaType, bytes });
    }
    const model = await this.deps.interchange.readMesh(bytes, document.format, `preview:${document.assetId}`);
    if (!model.ok) return model;
    return ok({ kind: 'model', ...model.value });
  }

  async deliverFile(file: { readonly name: string; readonly mediaType: string; readonly bytes: Uint8Array }): Promise<void> {
    await this.deps.externalFiles.deliver(file);
  }

  async exportImported(id: DocumentId, format: ImportFormat): Promise<Result<void>> {
    const original = await this.original(id);
    if (!original.ok) return original;
    const { document, bytes } = original.value;
    const converted = await this.deps.interchange.convert(bytes, document.format, format);
    if (!converted.ok) return converted;
    await this.deps.externalFiles.deliver({ name: `${document.name}.${format}`, mediaType: mediaTypes[format], bytes: converted.value });
    return ok(undefined);
  }

  /** An imported document with the bytes of its original file. */
  private async original(id: DocumentId): Promise<Result<{ document: Extract<CadDocument, { kind: 'imported' }>; bytes: Uint8Array }>> {
    const document = await this.deps.documents.load(id);
    if (document?.kind !== 'imported') return fail({ code: 'unknown-document', message: `Imported file ${id} does not exist.` });
    const asset = await this.deps.assets.fetch(document.assetId);
    if (!asset) return fail({ code: 'missing-original', message: `The original of ${document.name} is missing.` });
    return ok({ document, bytes: asset.bytes });
  }

  private async storeNewDocument(
    projectId: ProjectId,
    kind: CreatableDocumentKind,
    name: string,
  ): Promise<DocumentSummary> {
    const now = this.now();
    const header = {
      id: asDocumentId(this.deps.newId()),
      projectId,
      name,
      createdAt: now,
      modifiedAt: now,
      schemaVersion: currentSchemaVersion,
    };
    const document: CadDocument =
      kind === 'component'
        ? { ...header, kind, units: 'mm', parameters: [], timeline: [], rollbackIndex: 0 }
        : kind === 'drawing'
          ? { ...header, kind, sheet: { size: 'A3', orientation: 'landscape', scale: 1 }, titleBlock: { title: name, number: '', drawnBy: '', material: '', revision: 'A' }, views: [], annotations: [] }
          : { ...header, kind, instances: [], joints: [], motionStudies: [] };
    await this.deps.documents.store(document);
    return summarize(document);
  }

  async saveThumbnail(id: DocumentId, png: Uint8Array): Promise<void> {
    const document = await this.deps.documents.load(id);
    if (!document) return;
    await this.deps.assets.keep({ id: thumbnailId(id), projectId: document.projectId, name: 'thumbnail.png', byteLength: png.length, bytes: png });
  }

  async thumbnail(id: DocumentId): Promise<Uint8Array | undefined> {
    return (await this.deps.assets.fetch(thumbnailId(id)))?.bytes;
  }

  async projectThumbnail(id: ProjectId): Promise<Uint8Array | undefined> {
    const documents = [...(await this.deps.documents.enumerate(id))].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    for (const document of documents) {
      const png = await this.thumbnail(document.id);
      if (png) return png;
    }
    return undefined;
  }

  private async discardDocument(id: DocumentId): Promise<void> {
    const document = await this.deps.documents.load(id);
    if (document?.kind === 'imported') await this.deps.assets.release(document.assetId);
    await this.deps.assets.release(thumbnailId(id));
    await this.deps.documents.discard(id);
    this.deps.events.publish('documentDeleted', { documentId: id });
  }

  private async touchProject(id: ProjectId): Promise<void> {
    const project = await this.deps.projects.find(id);
    if (project) await this.deps.projects.revise({ ...project, modifiedAt: this.now() });
    this.scheduleVersion(id);
  }

  private async summarizeProject(project: Project): Promise<ProjectSummary> {
    const documents = await this.deps.documents.enumerate(project.id);
    return { ...project, documentCount: documents.length };
  }

  private now(): string {
    return this.deps.clock().toISOString();
  }
}

/** A new copy's earlier ids: each document's id in the original, and the ids it had before that (CAD-147). */
function copiedFrom(ids: ReadonlyMap<string, string>, earlier: Project['copiedFrom']): NonNullable<Project['copiedFrom']> {
  return Object.fromEntries([...ids].map(([old, now]) => [now, [old, ...(earlier?.[old] ?? [])]]));
}
