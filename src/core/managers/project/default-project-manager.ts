import type { AssetAccess } from '@core/access/asset';
import type { DocumentAccess } from '@core/access/document';
import type { ExternalFileAccess } from '@core/access/external-file';
import type { ProjectAccess } from '@core/access/project';
import {
  asAssetId,
  asDocumentId,
  asProjectId,
  type AssetId,
  type CadDocument,
  type CreatableDocumentKind,
  currentSchemaVersion,
  type DocumentId,
  type DocumentKind,
  documentKinds,
  type DocumentSummary,
  type DomainEvents,
  fail,
  type ImportFormat,
  ok,
  type Parameter,
  type Project,
  type ProjectId,
  type ProjectSummary,
  type Result,
  summarize,
} from '@core/contracts';
import type { InterchangeEngine } from '@core/engines/interchange';
import type { ParameterEngine } from '@core/engines/parameter';
import type { Clock } from '@core/utilities/clock';
import type { EventBus } from '@core/utilities/messaging';
import type { CreatedProject, ExternalFile, ImportedContent, ImportedView, ProjectManager } from './project-manager';

export interface ProjectManagerDependencies {
  readonly projects: ProjectAccess;
  readonly documents: DocumentAccess;
  readonly assets: AssetAccess;
  readonly externalFiles: ExternalFileAccess;
  readonly interchange: InterchangeEngine;
  /** Checks project parameters before they are saved. */
  readonly parameters: ParameterEngine;
  readonly events: EventBus<DomainEvents>;
  readonly clock: Clock;
  readonly newId: () => string;
}

const maxNameLength = 80;

/** Where a document's picture is kept among the project's assets. */
const thumbnailId = (documentId: DocumentId): AssetId => asAssetId(`thumbnail-${documentId}`);

const kindLabels: Readonly<Record<DocumentKind, string>> = {
  component: 'Component',
  assembly: 'Assembly',
  imported: 'Imported',
};

const mediaTypes: Readonly<Record<ImportFormat, string>> = {
  step: 'model/step',
  stl: 'model/stl',
  obj: 'model/obj',
  '3mf': 'model/3mf',
  dxf: 'image/vnd.dxf',
  svg: 'image/svg+xml',
};

const formatsByExtension: Readonly<Record<string, ImportFormat>> = {
  step: 'step',
  stp: 'step',
  stl: 'stl',
  obj: 'obj',
  '3mf': '3mf',
  dxf: 'dxf',
  svg: 'svg',
};

function validName(name: string): Result<string> {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > maxNameLength) {
    return fail({ code: 'invalid-name', message: `Names need 1 to ${maxNameLength} characters.` });
  }
  return ok(trimmed);
}

const unknownProject = (id: ProjectId) => fail({ code: 'unknown-project', message: `Project ${id} does not exist.` });
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
  constructor(private readonly deps: ProjectManagerDependencies) {}

  async listProjects(): Promise<ProjectSummary[]> {
    const projects = await this.deps.projects.enumerate();
    const summaries = await Promise.all(projects.map((p) => this.summarizeProject(p)));
    return summaries.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  }

  async findProject(id: ProjectId): Promise<ProjectSummary | undefined> {
    const project = await this.deps.projects.find(id);
    return project && this.summarizeProject(project);
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
    for (const document of await this.deps.documents.enumerate(id)) {
      await this.discardDocument(document.id);
    }
    await this.deps.projects.discard(id);
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
    await this.discardDocument(id);
    await this.touchProject(document.projectId);
  }

  async importFile(projectId: ProjectId, file: ExternalFile): Promise<Result<DocumentSummary>> {
    if (!(await this.deps.projects.find(projectId))) return unknownProject(projectId);
    const dot = file.name.lastIndexOf('.');
    const format = dot > 0 ? formatsByExtension[file.name.slice(dot + 1).toLowerCase()] : undefined;
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
        min: [extent((v) => Math.min(...v)), extentY((v) => Math.min(...v)), 0],
        max: [extent((v) => Math.max(...v)), extentY((v) => Math.max(...v)), 0],
      });
    }
    const model = await this.deps.interchange.readMesh(bytes, document.format, `preview:${document.assetId}`);
    if (!model.ok) return model;
    return ok({ kind: 'model', ...model.value });
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
  }

  private async summarizeProject(project: Project): Promise<ProjectSummary> {
    const documents = await this.deps.documents.enumerate(project.id);
    return { ...project, documentCount: documents.length };
  }

  private now(): string {
    return this.deps.clock().toISOString();
  }
}
