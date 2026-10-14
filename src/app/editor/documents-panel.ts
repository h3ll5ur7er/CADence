import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { CreatableDocumentKind, DocumentKind, DocumentSummary } from '@core/contracts';
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
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './documents-panel.html',
  styleUrl: './documents-panel.scss',
})
export class DocumentsPanel {
  readonly documents = input.required<readonly DocumentSummary[]>();
  readonly activeId = input<string | undefined>();
  readonly create = output<CreatableDocumentKind>();
  readonly importFile = output<File>();
  readonly rename = output<DocumentSummary>();
  readonly remove = output<DocumentSummary>();

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
