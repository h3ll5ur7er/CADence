import type { Attachment, CadDocument, Parameter, Project, ProjectTemplate } from '@core/contracts';

/**
 * A project's content, apart from where it is kept: its settings, documents and imported originals.
 * Duplicates, archives and templates are made of it.
 */
export interface ProjectBundle {
  readonly name: string;
  readonly parameters: readonly Parameter[];
  /** As stored; their `projectId` is replaced when the bundle becomes a project. */
  readonly documents: readonly CadDocument[];
  /** Imported originals and attached files, by asset id. */
  readonly originals: ReadonlyMap<string, Uint8Array>;
  /** The project's notes and attachments (CAD-149). */
  readonly description?: string;
  readonly attachments?: readonly Attachment[];
  /** The project is a library of this id (CAD-151). */
  readonly library?: NonNullable<Project['library']>;
  /** The ids a copy's documents had in its history (`Project.copiedFrom`, CAD-147). */
  readonly copiedFrom?: Project['copiedFrom'];
}

/** Every JSON string; ids are always whole strings, never parts of one. */
const jsonStrings = /"((?:[^"\\]|\\.)*)"/g;

/**
 * The bundle with new ids for its documents and originals. References between them (assembly
 * instances, inserted files and drawings, imported documents' originals) follow.
 */
export function withNewIds(bundle: ProjectBundle, newId: () => string): ProjectBundle {
  return copyOf(bundle, newId).bundle;
}

/** The bundle with new ids, and which new id each old one became (documents and originals). */
export function copyOf(bundle: ProjectBundle, newId: () => string): { bundle: ProjectBundle; ids: ReadonlyMap<string, string> } {
  const ids = new Map<string, string>();
  for (const document of bundle.documents) {
    ids.set(document.id, newId());
    if (document.kind === 'imported') ids.set(document.assetId, newId());
  }
  // Attached files are assets too: a copy has its own.
  for (const attachment of bundle.attachments ?? []) if (attachment.kind === 'file') ids.set(attachment.assetId, newId());
  return {
    bundle: {
      ...bundle,
      documents: bundle.documents.map((document) => JSON.parse(remapIds(JSON.stringify(document), ids)) as CadDocument),
      ...(bundle.attachments ? { attachments: JSON.parse(remapIds(JSON.stringify(bundle.attachments), ids)) as Attachment[] } : {}),
      originals: new Map([...bundle.originals].map(([id, bytes]) => [ids.get(id) ?? id, bytes])),
    },
    ids,
  };
}

/** JSON with every string that is one of the ids replaced by the id it became. */
export function remapIds(json: string, ids: ReadonlyMap<string, string>): string {
  return json.replace(jsonStrings, (whole, value: string) => (ids.has(value) ? JSON.stringify(ids.get(value)) : whole));
}

/** A template as a bundle: it has no originals. */
export const templateBundle = (template: ProjectTemplate): ProjectBundle => ({
  name: template.name,
  parameters: template.parameters,
  documents: template.documents,
  originals: new Map(),
});

/** What identifies a CADence archive (`cadence.json` at its root). */
export const archiveFormat = 'cadence-project';
export const archiveVersion = 1;

/** The files of an archive (zip): its settings, documents, originals and, optionally, the history. */
export function archiveFiles(bundle: ProjectBundle, history: readonly { path: string; bytes: Uint8Array }[] = []): { name: string; bytes: Uint8Array }[] {
  const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2));
  return [
    { name: 'cadence.json', bytes: text({ format: archiveFormat, version: archiveVersion, name: bundle.name, parameters: bundle.parameters, ...(bundle.copiedFrom ? { copiedFrom: bundle.copiedFrom } : {}), ...notesOf(bundle) }) },
    ...bundle.documents.map((document) => ({ name: `documents/${document.id}.json`, bytes: text({ ...document, projectId: undefined }) })),
    ...[...bundle.originals].map(([id, bytes]) => ({ name: `originals/${id}`, bytes })),
    ...history.map((file) => ({ name: `history/${file.path}`, bytes: file.bytes })),
  ];
}

/** An archive's bundle and history; undefined when the files are not a CADence archive. */
export function readArchive(files: ReadonlyMap<string, Uint8Array>): { bundle: ProjectBundle; history: { path: string; bytes: Uint8Array }[] } | undefined {
  const manifest = files.get('cadence.json');
  if (!manifest) return undefined;
  const settings = JSON.parse(new TextDecoder().decode(manifest)) as { format?: string; version?: number; name?: string; parameters?: Parameter[]; copiedFrom?: Project['copiedFrom'] } & Pick<ProjectBundle, 'description' | 'attachments' | 'library'>;
  if (settings.format !== archiveFormat || (settings.version ?? 0) > archiveVersion) return undefined;
  const documents: CadDocument[] = [];
  const originals = new Map<string, Uint8Array>();
  const history: { path: string; bytes: Uint8Array }[] = [];
  for (const [path, bytes] of files) {
    if (/^documents\/[^/]+\.json$/.test(path)) documents.push(JSON.parse(new TextDecoder().decode(bytes)) as CadDocument);
    else if (path.startsWith('originals/')) originals.set(path.slice('originals/'.length), bytes);
    else if (path.startsWith('history/') && !path.endsWith('/')) history.push({ path: path.slice('history/'.length), bytes });
  }
  return { bundle: { name: settings.name ?? 'Imported project', parameters: settings.parameters ?? [], documents, originals, ...(settings.copiedFrom ? { copiedFrom: settings.copiedFrom } : {}), ...notesOf(settings) }, history };
}

/** A project's description, attachments and library mark, where it has them: settings kept in archives and versions. */
export function notesOf(settings: Pick<ProjectBundle, 'description' | 'attachments' | 'library'>): Pick<ProjectBundle, 'description' | 'attachments' | 'library'> {
  return {
    ...(settings.description ? { description: settings.description } : {}),
    ...(settings.attachments?.length ? { attachments: settings.attachments } : {}),
    ...(settings.library ? { library: settings.library } : {}),
  };
}
