import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DocumentId, CreatableDocumentKind, DocumentKind, DocumentSummary } from '@core/contracts';
import { carriesFiles, droppedFiles } from '../shared/drop';
import { Thumbnail } from '../shared/thumbnail';
import { Icon, type IconName } from '../shared/icon';

export const importAccept = '.step,.stp,.stl,.obj,.3mf,.dxf,.svg,.png,.jpg,.jpeg';

const groups: readonly { kind: DocumentKind; label: string; icon: IconName }[] = [
  { kind: 'component', label: 'Components', icon: 'component' },
  { kind: 'assembly', label: 'Assemblies', icon: 'assembly' },
  { kind: 'drawing', label: 'Drawings', icon: 'drawing' },
  { kind: 'imported', label: 'Imported', icon: 'imported' },
];

/**
 * The project's documents, grouped by kind, with create, import (picked or dropped), duplicate,
 * replace, rename and delete; parts taken from libraries in a group of their own, with updates (CAD-151).
 */
@Component({
  selector: 'cad-documents-panel',
  host: {
    '[class.dropping]': 'dropping()',
    '(dragover)': 'dragOver($event)',
    '(dragleave)': 'dropping.set(false)',
    '(drop)': 'dropped($event)',
  },
  imports: [Thumbnail, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents-panel.html',
  styleUrl: './documents-panel.scss',
})
export class DocumentsPanel {
  readonly documents = input.required<readonly DocumentSummary[]>();
  readonly activeId = input<string | undefined>();
  /** Loads a document's picture. */
  readonly thumbnail = input<(id: DocumentId) => Promise<Uint8Array | undefined>>(async () => undefined);
  /** Changes when a picture was saved, so they are loaded again. */
  readonly thumbnailsSaved = input(0);
  protected readonly loader = (id: DocumentId) => () => this.thumbnail()(id);
  readonly create = output<CreatableDocumentKind>();
  readonly importFile = output<File>();
  readonly rename = output<DocumentSummary>();
  readonly remove = output<DocumentSummary>();
  readonly history = output<DocumentSummary>();
  readonly duplicate = output<DocumentSummary>();
  /** A newer file for an imported document. */
  readonly replace = output<{ readonly document: DocumentSummary; readonly file: File }>();
  /** Library parts whose library has a newer version of them. */
  readonly updates = input<ReadonlySet<string>>(new Set());
  /** Brings a library part to its library's latest version. */
  readonly update = output<DocumentSummary>();
  /** Files are dragged over the panel. */
  protected readonly dropping = signal(false);

  protected readonly groups = groups;
  protected readonly accept = importAccept;

  protected ofKind(kind: DocumentKind): DocumentSummary[] {
    return this.documents().filter((d) => d.kind === kind && !d.library);
  }

  /** The parts taken from libraries, and what they brought along. */
  protected readonly libraryParts = computed(() => this.documents().filter((d) => d.library));
  protected readonly iconOf = (kind: DocumentKind): IconName => groups.find((g) => g.kind === kind)?.icon ?? 'component';

  protected replaced(document: DocumentSummary, input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.replace.emit({ document, file });
  }

  protected dragOver(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dropping.set(true);
  }

  protected dropped(event: DragEvent): void {
    this.dropping.set(false);
    if (!carriesFiles(event)) return;
    event.preventDefault();
    for (const file of droppedFiles(event)) this.importFile.emit(file);
  }

  protected picked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.importFile.emit(file);
  }
}
