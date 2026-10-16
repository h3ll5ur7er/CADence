import type { CadDocument, Parameter, ProjectTemplate } from '@core/contracts';

/**
 * A project's content, apart from where it is kept: its settings, documents and imported originals.
 * Duplicates, archives and templates are made of it.
 */
export interface ProjectBundle {
  readonly name: string;
  readonly parameters: readonly Parameter[];
  /** As stored; their `projectId` is replaced when the bundle becomes a project. */
  readonly documents: readonly CadDocument[];
  /** Imported originals by asset id. */
  readonly originals: ReadonlyMap<string, Uint8Array>;
}

/** Every JSON string; ids are always whole strings, never parts of one. */
const jsonStrings = /"((?:[^"\\]|\\.)*)"/g;

/**
 * The bundle with new ids for its documents and originals. References between them (assembly
 * instances, inserted files and drawings, imported documents' originals) follow.
 */
export function withNewIds(bundle: ProjectBundle, newId: () => string): ProjectBundle {
  const ids = new Map<string, string>();
  for (const document of bundle.documents) {
    ids.set(document.id, newId());
    if (document.kind === 'imported') ids.set(document.assetId, newId());
  }
  const remap = (text: string) => text.replace(jsonStrings, (whole, value: string) => (ids.has(value) ? JSON.stringify(ids.get(value)) : whole));
  return {
    ...bundle,
    documents: bundle.documents.map((document) => JSON.parse(remap(JSON.stringify(document))) as CadDocument),
    originals: new Map([...bundle.originals].map(([id, bytes]) => [ids.get(id) ?? id, bytes])),
  };
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
    { name: 'cadence.json', bytes: text({ format: archiveFormat, version: archiveVersion, name: bundle.name, parameters: bundle.parameters }) },
    ...bundle.documents.map((document) => ({ name: `documents/${document.id}.json`, bytes: text({ ...document, projectId: undefined }) })),
    ...[...bundle.originals].map(([id, bytes]) => ({ name: `originals/${id}`, bytes })),
    ...history.map((file) => ({ name: `history/${file.path}`, bytes: file.bytes })),
  ];
}

/** An archive's bundle and history; undefined when the files are not a CADence archive. */
export function readArchive(files: ReadonlyMap<string, Uint8Array>): { bundle: ProjectBundle; history: { path: string; bytes: Uint8Array }[] } | undefined {
  const manifest = files.get('cadence.json');
  if (!manifest) return undefined;
  const settings = JSON.parse(new TextDecoder().decode(manifest)) as { format?: string; version?: number; name?: string; parameters?: Parameter[] };
  if (settings.format !== archiveFormat || (settings.version ?? 0) > archiveVersion) return undefined;
  const documents: CadDocument[] = [];
  const originals = new Map<string, Uint8Array>();
  const history: { path: string; bytes: Uint8Array }[] = [];
  for (const [path, bytes] of files) {
    if (/^documents\/[^/]+\.json$/.test(path)) documents.push(JSON.parse(new TextDecoder().decode(bytes)) as CadDocument);
    else if (path.startsWith('originals/')) originals.set(path.slice('originals/'.length), bytes);
    else if (path.startsWith('history/') && !path.endsWith('/')) history.push({ path: path.slice('history/'.length), bytes });
  }
  return { bundle: { name: settings.name ?? 'Imported project', parameters: settings.parameters ?? [], documents, originals }, history };
}
