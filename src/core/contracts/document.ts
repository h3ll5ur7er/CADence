import type { Appearance } from './appearance';
import type { AssetId, DocumentId, ProjectId } from './ids';
import type { Timestamp } from './project';
import type { Material, ManufacturingProfile, SimulationSetup } from './analysis';
import type { ExplodedView, Instance, InstancePattern, Joint, MotionLink, MotionStudy } from './assembly';
import type { Feature } from './feature';
import type { Sketch } from './sketch';
import type { DrawingAnnotation, DrawingView, Sheet, TitleBlock } from './drawing';

export type DocumentKind = 'component' | 'assembly' | 'drawing' | 'imported';
export const documentKinds: readonly DocumentKind[] = ['component', 'assembly', 'drawing', 'imported'];

/** The kinds a user creates from scratch; imported documents come from files. */
export type CreatableDocumentKind = Exclude<DocumentKind, 'imported'>;

export type LengthUnit = 'mm' | 'cm' | 'in';

/** Millimetres in one unit. Geometry is always stored and computed in millimetres. */
export const lengthUnitSize: Readonly<Record<LengthUnit, number>> = { mm: 1, cm: 10, in: 25.4 };

export const lengthUnitNames: Readonly<Record<LengthUnit, string>> = { mm: 'Millimetres', cm: 'Centimetres', in: 'Inches' };

/**
 * A length as typed in a document's unit: a plain number gets the unit written out, so the stored
 * expression means the same length whatever the document's unit is later (plain numbers are millimetres).
 */
export function lengthExpression(typed: string, unit: LengthUnit): string {
  const text = typed.trim();
  return unit !== 'mm' && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text) ? `${text} ${unit}` : text;
}
export type ImportFormat = 'step' | 'stl' | 'obj' | '3mf' | 'dxf' | 'svg' | 'png' | 'jpg' | 'ttf' | 'otf' | 'woff';

/** 3D files: what components insert as bodies and assemblies as parts. */
export type ModelFormat = 'step' | 'stl' | 'obj' | '3mf';
export const isModelFormat = (format: ImportFormat | undefined): format is ModelFormat => format === 'step' || format === 'stl' || format === 'obj' || format === '3mf';

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

/** A group of consecutive timeline items, from `first` to `last` in timeline order; folders do not nest. */
export interface TimelineFolder {
  readonly id: string;
  readonly name: string;
  readonly first: string;
  readonly last: string;
  readonly note?: string;
}

/** The ids of a folder's items, in timeline order (none when its ends are missing or out of order). */
export function folderItems(folder: TimelineFolder, timeline: readonly TimelineItem[]): string[] {
  const [from, to] = [timeline.findIndex((i) => i.id === folder.first), timeline.findIndex((i) => i.id === folder.last)];
  return from < 0 || to < from ? [] : timeline.slice(from, to + 1).map((i) => i.id);
}

/** A named variant of a component: other values for some of its (or its project's) parameters. */
export interface Configuration {
  readonly id: string;
  readonly name: string;
  /** Expressions by parameter name. */
  readonly values: Readonly<Record<string, string>>;
}

export interface ComponentDocument extends DocumentBase {
  readonly kind: 'component';
  readonly units: LengthUnit;
  readonly parameters: readonly Parameter[];
  /** The component's configuration table. */
  readonly configurations?: readonly Configuration[];
  /** The configuration being edited and shown (absent: the parameters' own values). */
  readonly configuration?: string;
  readonly timeline: readonly TimelineItem[];
  /** Folders grouping timeline items. */
  readonly folders?: readonly TimelineFolder[];
  /**
   * How many items at the end of the timeline are rolled back: they are kept but not run, and new
   * items are inserted before them. 0 puts the rollback marker at the end.
   */
  readonly rollbackIndex: number;
  /** For mass; `materials[0]` when absent. */
  readonly material?: Material;
  /** The machine the component is made on, for validation; `manufacturingProfiles[0]` when absent. */
  readonly process?: ManufacturingProfile;
  /** How bodies are shown, by body id; bodies without an entry use the defaults. */
  readonly appearances?: Readonly<Record<string, Appearance>>;
  /** The strength check's fixed faces and loads. */
  readonly simulation?: SimulationSetup;
}

export interface AssemblyDocument extends DocumentBase {
  readonly kind: 'assembly';
  readonly instances: readonly Instance[];
  readonly joints: readonly Joint[];
  readonly motionStudies: readonly MotionStudy[];
  /** Copies of instances in rows, around axes or mirrored. */
  readonly patterns?: readonly InstancePattern[];
  /** Joints that drive other joints (gears, racks, belts). */
  readonly links?: readonly MotionLink[];
  readonly explodedViews?: readonly ExplodedView[];
}

/** A technical drawing of components and assemblies of the project (docs/Architecture/Document-model.md#drawings). */
export interface DrawingDocument extends DocumentBase {
  readonly kind: 'drawing';
  readonly sheet: Sheet;
  readonly titleBlock: TitleBlock;
  readonly views: readonly DrawingView[];
  readonly annotations: readonly DrawingAnnotation[];
}

export interface ImportedDocument extends DocumentBase {
  readonly kind: 'imported';
  readonly assetId: AssetId;
  readonly format: ImportFormat;
  /** Name of the original file, e.g. `bracket.step`. */
  readonly fileName: string;
  readonly byteLength: number;
}

export type CadDocument = ComponentDocument | AssemblyDocument | DrawingDocument | ImportedDocument;

/**
 * 2: assemblies got motion studies. 3: the fields added by phases 21 to 33 (joint leans, view
 * configurations, …), so that older apps refuse documents they would show wrongly (CAD-145). Raise it
 * whenever a field is added that an older app must not ignore.
 */
export const currentSchemaVersion = 3;

export function summarize(document: CadDocument): DocumentSummary {
  const { id, projectId, kind, name, createdAt, modifiedAt } = document;
  return { id, projectId, kind, name, createdAt, modifiedAt, ...(document.kind === 'imported' ? { format: document.format } : {}) };
}

/** Imported documents a part or assembly can use as a solid. */
export const isImportedModel = (d: DocumentSummary): boolean => d.kind === 'imported' && isModelFormat(d.format);
/** Imported documents a sketch can take curves from. */
export const isImportedDrawing = (d: DocumentSummary): boolean => d.kind === 'imported' && (d.format === 'dxf' || d.format === 'svg');
/** Imported PNG and JPEG pictures: backgrounds to trace over in sketches, or outlines to trace. */
export const isImportedPicture = (d: DocumentSummary): boolean => d.kind === 'imported' && (d.format === 'png' || d.format === 'jpg');
/** Imported fonts (TTF, OTF, WOFF), for sketch texts. */
export const isFontFormat = (format: ImportFormat | undefined): format is 'ttf' | 'otf' | 'woff' => format === 'ttf' || format === 'otf' || format === 'woff';
export const isImportedFont = (d: DocumentSummary): boolean => d.kind === 'imported' && isFontFormat(d.format);
