import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  asDocumentId,
  asProjectId,
  type CreatableDocumentKind,
  type DocumentId,
  type DocumentSummary,
} from '@core/contracts';
import { PROJECT_MANAGER, STORAGE_KIND } from '../core.providers';
import { ConfirmDialog, NameDialog } from '../shared/dialogs';
import { Icon } from '../shared/icon';
import { SettingsDialog } from '../shared/settings-dialog';
import { DocumentsPanel } from './documents-panel';
import { EditorStatus } from './editor-status';
import { HistoryDialog } from './history-dialog';
import { ThumbnailSaver } from './thumbnail-saver';
import { AssemblyMode } from './modes/assembly-mode';
import { ComponentMode } from './modes/component-mode';
import { ImportedMode } from './modes/imported-mode';

const kindLabels = { component: 'Component', assembly: 'Assembly', imported: 'Imported' } as const;
const storageLabels = { browser: 'This browser', 'project-folders': 'Project folders', memory: 'Memory only' } as const;

@Component({
  selector: 'cad-editor-page',
  imports: [RouterLink, Icon, DocumentsPanel, ComponentMode, AssemblyMode, ImportedMode, NameDialog, ConfirmDialog, SettingsDialog, HistoryDialog],
  providers: [EditorStatus, ThumbnailSaver],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor-page.html',
  styleUrl: './editor-page.scss',
})
export class EditorPage {
  /** Route parameters (bound by the router). */
  readonly projectId = input.required<string>();
  readonly documentId = input<string>();

  protected readonly status = inject(EditorStatus);
  protected readonly thumbnails = inject(ThumbnailSaver);
  /** A document's picture, for the documents panel. */
  protected readonly thumbnailOf = (id: DocumentId) => this.projectManager.thumbnail(id);
  protected readonly kindLabels = kindLabels;
  protected readonly storage = storageLabels[inject(STORAGE_KIND)];
  protected readonly message = signal<string | undefined>(undefined);
  private readonly projectManager = inject(PROJECT_MANAGER);
  private readonly router = inject(Router);
  private readonly nameDialog = viewChild.required(NameDialog);
  private readonly confirmDialog = viewChild.required(ConfirmDialog);

  protected readonly project = resource({
    params: () => asProjectId(this.projectId()),
    loader: ({ params }) => this.projectManager.findProject(params),
  });
  protected readonly documents = resource({
    params: () => asProjectId(this.projectId()),
    loader: ({ params }) => this.projectManager.listDocuments(params),
  });
  protected readonly active = computed(() => this.documents.value()?.find((d) => d.id === this.documentId()));

  constructor() {
    effect(() => this.thumbnails.document.set(this.documentId() ? asDocumentId(this.documentId() as string) : undefined));
    // A project opened without a document shows its most recently edited one.
    effect(() => {
      const documents = this.documents.value();
      if (this.documentId() || !documents?.length) return;
      const latest = [...documents].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0];
      if (latest) void this.open(latest, true);
    });
  }

  protected async create(kind: CreatableDocumentKind): Promise<void> {
    const result = await this.projectManager.createDocument(asProjectId(this.projectId()), kind);
    if (!result.ok) return this.message.set(result.error.message);
    this.message.set(undefined);
    this.refresh();
    await this.open(result.value);
  }

  protected async importFile(file: File): Promise<void> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await this.projectManager.importFile(asProjectId(this.projectId()), { name: file.name, bytes });
    if (!result.ok) return this.message.set(result.error.message);
    this.message.set(undefined);
    this.refresh();
    await this.open(result.value);
  }

  protected async rename(document: DocumentSummary): Promise<void> {
    const name = await this.nameDialog().ask({
      heading: `Rename ${kindLabels[document.kind].toLowerCase()}`,
      confirmLabel: 'Rename',
      initial: document.name,
    });
    if (!name || name === document.name) return;
    await this.projectManager.renameDocument(document.id, name);
    this.refresh();
  }

  protected async remove(document: DocumentSummary): Promise<void> {
    const confirmed = await this.confirmDialog().confirm({
      heading: `Delete “${document.name}”?`,
      message: 'The document is removed from this project. It cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    await this.projectManager.deleteDocument(document.id);
    if (document.id === this.documentId()) await this.router.navigate(['/projects', this.projectId()]);
    this.refresh();
  }

  protected async renameProject(): Promise<void> {
    const project = this.project.value();
    if (!project) return;
    const name = await this.nameDialog().ask({ heading: 'Rename project', confirmLabel: 'Rename', initial: project.name });
    if (!name || name === project.name) return;
    await this.projectManager.renameProject(project.id, name);
    this.project.reload();
  }

  private open(document: DocumentSummary, replaceUrl = false): Promise<boolean> {
    return this.router.navigate(['/projects', document.projectId, 'documents', document.id], { replaceUrl });
  }

  private refresh(): void {
    this.documents.reload();
    this.project.reload();
  }
}
