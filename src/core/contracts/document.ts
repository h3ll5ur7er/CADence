import type { AssetId, DocumentId, ProjectId } from './ids';
import type { Timestamp } from './project';
import type { Feature } from './feature';
import type { Sketch } from './sketch';

export type DocumentKind = 'component' | 'assembly' | 'imported';
export const documentKinds: readonly DocumentKind[] = ['component', 'assembly', 'imported'];

/** The kinds a user creates from scratch; imported documents come from files. */
export type CreatableDocumentKind = Exclude<DocumentKind, 'imported'>;

export type LengthUnit = 'mm' | 'cm' | 'in';
export type ImportFormat = 'step' | 'stl' | 'obj' | '3mf' | 'dxf' | 'svg';

export interface DocumentSummary {
  readonly id: DocumentId;
  readonly projectId: ProjectId;
  readonly kind: DocumentKind;
  readonly name: string;
  readonly createdAt: Timestamp;
  readonly modifiedAt: Timestamp;
}

/** Persisted design intent; see docs/Architecture/Document-model.md. */
interface DocumentBase extends DocumentSummary {
  readonly schemaVersion: number;
}

export interface Parameter {
  readonly id: string;
  readonly name: string;
  readonly expression: string;
  readonly comment?: string;
}

/** Items of a component's parametric history, applied in order. */
export type TimelineItem = Sketch | Feature;

export const isSketch = (item: TimelineItem): item is Sketch => item.type === 'sketch';

export interface ComponentDocument extends DocumentBase {
  readonly kind: 'component';
  readonly units: LengthUnit;
  readonly parameters: readonly Parameter[];
  readonly timeline: readonly TimelineItem[];
  readonly rollbackIndex: number;
}

export interface AssemblyDocument extends DocumentBase {
  readonly kind: 'assembly';
  readonly instances: readonly unknown[];
  readonly joints: readonly unknown[];
}

export interface ImportedDocument extends DocumentBase {
  readonly kind: 'imported';
  readonly assetId: AssetId;
  readonly format: ImportFormat;
  /** Name of the original file, e.g. `bracket.step`. */
  readonly fileName: string;
  readonly byteLength: number;
}

export type CadDocument = ComponentDocument | AssemblyDocument | ImportedDocument;

export const currentSchemaVersion = 1;

export function summarize(document: CadDocument): DocumentSummary {
  const { id, projectId, kind, name, createdAt, modifiedAt } = document;
  return { id, projectId, kind, name, createdAt, modifiedAt };
}
