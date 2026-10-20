import { asAssetId, type CadDocument, type DocumentSummary, type LibraryLink, type Parameter, type ProjectId } from '@core/contracts';
import { remapIds } from './project-bundles';

/** Every JSON string; ids are always whole strings, never parts of one. */
const jsonStrings = /"((?:[^"\\]|\\.)*)"/g;

/** What a library part brings into the project that uses it. */
export interface LibraryCopies {
  /** The part first, then the library documents it uses (imported files, fonts, pictures). */
  readonly documents: readonly CadDocument[];
  /** Originals to keep: the copy's asset id → the library's. */
  readonly originals: ReadonlyMap<string, string>;
}

/**
 * A library component as the project that uses it keeps it (docs/Architecture/Decisions.md#ADR-53a):
 * the part and the library documents it refers to, each with an id of this project (the id it had
 * when it was taken before, so instances keep pointing at it) and a link to where it came from. The
 * library's project parameters come along as the part's own, so its expressions mean what they meant there.
 */
export function libraryCopies(options: {
  readonly part: CadDocument;
  readonly library: readonly CadDocument[];
  readonly parameters: readonly Parameter[];
  readonly link: Omit<LibraryLink, 'document'>;
  /** The documents of the using project already taken from this library. */
  readonly taken: readonly CadDocument[];
  readonly projectId: ProjectId;
  readonly now: string;
  readonly newId: () => string;
}): LibraryCopies {
  const { part, library, link, taken, projectId, now, newId } = options;
  const byId = new Map(library.map((d) => [d.id as string, d]));
  const needed: CadDocument[] = [part];
  // What is found is searched too (an array grows under for-of).
  for (const document of needed) {
    for (const [, value] of JSON.stringify(document).matchAll(jsonStrings)) {
      const used = value === undefined ? undefined : byId.get(value);
      if (used && used.id !== part.id && !needed.includes(used)) needed.push(used);
    }
  }
  const before = new Map(taken.flatMap((d) => (d.library ? [[d.library.document, d] as const] : [])));
  const ids = new Map<string, string>();
  const originals = new Map<string, string>();
  for (const document of needed) {
    const earlier = before.get(document.id);
    ids.set(document.id, earlier?.id ?? newId());
    if (document.kind === 'imported') {
      const asset = earlier?.kind === 'imported' ? earlier.assetId : newId();
      ids.set(document.assetId, asset);
      originals.set(asset, document.assetId);
    }
  }
  const documents = needed.map((document) => {
    const copy = JSON.parse(remapIds(JSON.stringify(document), ids)) as CadDocument;
    const own = copy.kind === 'component' ? new Set(copy.parameters.map((p) => p.name)) : new Set<string>();
    return {
      ...copy,
      projectId,
      createdAt: before.get(document.id)?.createdAt ?? now,
      modifiedAt: now,
      library: { ...link, document: document.id },
      ...(copy.kind === 'component' ? { parameters: [...options.parameters.filter((p) => !own.has(p.name)), ...copy.parameters] } : {}),
    } as CadDocument;
  });
  return { documents, originals: new Map([...originals].map(([mine, theirs]) => [asAssetId(mine), theirs])) };
}

/** A project's documents taken from a library (its parts, and what they brought along). */
export function takenFrom(documents: readonly DocumentSummary[], library: string): DocumentSummary[] {
  return documents.filter((d) => d.library?.library === library);
}
