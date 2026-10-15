import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DocumentId, CreatableDocumentKind, DocumentKind, DocumentSummary } from '@core/contracts';
import { Thumbnail } from '../shared/thumbnail';
import { Icon, type IconName } from '../shared/icon';

export const importAccept = '.step,.stp,.stl,.obj,.3mf,.dxf,.svg';

const groups: readonly { kind: DocumentKind; label: string; icon: IconName }[] = [
  { kind: 'component', label: 'Components', icon: 'component' },
  { kind: 'assembly', label: 'Assemblies', icon: 'assembly' },
  { kind: 'imported', label: 'Imported', icon: 'imported' },
];

/** The project's documents, grouped by kind, with create, import, rename and delete. */
@Component({
  selector: 'cad-documents-panel',
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

  protected readonly groups = groups;
  protected readonly accept = importAccept;

  protected ofKind(kind: DocumentKind): DocumentSummary[] {
    return this.documents().filter((d) => d.kind === kind);
  }

  protected picked(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.importFile.emit(file);
  }
}
