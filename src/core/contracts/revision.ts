/**
 * Differences between versions of a document, and what a three-way merge could not decide
 * (docs/Architecture/Decisions.md#adr-61).
 */

/** One difference between two versions of a document (CAD-175). */
export interface DocumentChange {
  readonly kind: 'added' | 'removed' | 'changed' | 'moved';
  /**
   * Where it is in the document, by ids and names: `timeline/e2`, `timeline/s1/entities/c3`,
   * `parameters/width`, `material`. Merge conflicts and their resolutions use the same paths.
   */
  readonly path: string;
  /** What it is, in words: "Extrude 2", "Sketch 1: circle c3", "Parameter width", "Material". */
  readonly label: string;
  /** The part of the document it is in: `timeline`, `sketch`, `parameters`, `settings`, `instances`, … */
  readonly area: string;
  /** For changes: the fields that differ, before → after ("distance 6 mm → 8 mm"). */
  readonly details?: readonly string[];
}

/** An item both sides changed, each in its own way (CAD-176): one of them is chosen, by its path. */
export interface ItemConflict {
  readonly path: string;
  readonly label: string;
  /** How each side has it, in words (the fields in which they differ; "deleted" when one removed it). */
  readonly mine: string;
  readonly theirs: string;
}

const verbs: Readonly<Record<DocumentChange['kind'], string>> = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' };

/** A change in words: "Added Extrude 2", "Changed Parameter width: 60 mm → 80 mm". */
export function describeChange(change: DocumentChange): string {
  const details = change.details?.length ? `: ${change.details.join(', ')}` : '';
  return `${verbs[change.kind]} ${change.label}${details}`;
}
