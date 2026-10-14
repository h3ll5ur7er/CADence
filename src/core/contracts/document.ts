import type { AssetId, DocumentId, ProjectId } from './ids';
import type { Timestamp } from './project';
import type { Material, ManufacturingProfile } from './analysis';
import type { Instance, Joint, MotionStudy } from './assembly';
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
  /** Imported documents: the file format, so lists can tell drawings from 3D files. */
  readonly format?: ImportFormat;
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
  /** For mass; `materials[0]` when absent. */
  readonly material?: Material;
  /** The machine the component is made on, for validation; `manufacturingProfiles[0]` when absent. */
  readonly process?: ManufacturingProfile;
}

export interface AssemblyDocument extends DocumentBase {
  readonly kind: 'assembly';
  readonly instances: readonly Instance[];
  readonly joints: readonly Joint[];
  readonly motionStudies: readonly MotionStudy[];
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

/** 2: assemblies got motion studies. */
export const currentSchemaVersion = 2;

export function summarize(document: CadDocument): DocumentSummary {
  const { id, projectId, kind, name, createdAt, modifiedAt } = document;
  return { id, projectId, kind, name, createdAt, modifiedAt, ...(document.kind === 'imported' ? { format: document.format } : {}) };
}

/** Imported documents a part or assembly can use as a solid. */
export const isImportedModel = (d: DocumentSummary): boolean => d.kind === 'imported' && d.format !== undefined && d.format !== 'dxf' && d.format !== 'svg';
/** Imported documents a sketch can take curves from. */
export const isImportedDrawing = (d: DocumentSummary): boolean => d.kind === 'imported' && (d.format === 'dxf' || d.format === 'svg');
