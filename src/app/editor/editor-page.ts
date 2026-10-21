import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Shortcuts } from '../shared/shortcuts';
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
import { AboutDialog } from '../about/about-dialog';
import { SyncDialog } from './sync-dialog';
import { ProjectDialog } from './project-dialog';
import { ThumbnailSaver } from './thumbnail-saver';
import { AssemblyMode } from './modes/assembly-mode';
import { ComponentMode } from './modes/component-mode';
import { ImportedMode } from './modes/imported-mode';
import { DrawingMode } from './modes/drawing-mode';

const kindLabels = { component: 'Component', assembly: 'Assembly', drawing: 'Drawing', imported: 'Imported' } as const;
const storageLabels = { browser: 'This browser', 'project-folders': 'Project folders', memory: 'Memory only' } as const;

@Component({
  selector: 'cad-editor-page',
  imports: [RouterLink, Icon, DocumentsPanel, ComponentMode, AssemblyMode, DrawingMode, ImportedMode, NameDialog, ConfirmDialog, SettingsDialog, HistoryDialog, SyncDialog, AboutDialog, ProjectDialog],
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
  protected readonly emptySet: ReadonlySet<string> = new Set();
  private readonly projectManager = inject(PROJECT_MANAGER);
  private readonly router = inject(Router);
  private readonly nameDialog = viewChild.required(NameDialog);
  private readonly confirmDialog = viewChild.required(ConfirmDialog);
  private readonly syncDialog = viewChild.required(SyncDialog);
  private readonly aboutDialog = viewChild.required(AboutDialog);
  private readonly history = viewChild.required(HistoryDialog);
  private readonly notes = viewChild.required(ProjectDialog);

  protected readonly project = resource({
    params: () => asProjectId(this.projectId()),
    loader: ({ params }) => this.projectManager.findProject(params),
  });
  protected readonly documents = resource({
    params: () => asProjectId(this.projectId()),
    loader: ({ params }) => this.projectManager.listDocuments(params),
  });
  /**
   * The open document. Lists read again (a change elsewhere, CAD-150) give it anew; it is the same one
   * as long as it has the same name, so the editor showing it stays open (its store follows changes).
   */
  protected readonly active = computed(() => this.documents.value()?.find((d) => d.id === this.documentId()), {
    // An imported file has no editor: a replaced one is shown anew.
    equal: (a, b) => a?.id === b?.id && a?.name === b?.name && a?.library?.version === b?.library?.version && (a?.kind !== 'imported' || a.modifiedAt === b?.modifiedAt),
  });
  /** Library parts whose library has a newer version (CAD-151). */
  protected readonly updates = resource({
    params: () => ({ project: asProjectId(this.projectId()), documents: this.documents.value() }),
    loader: async ({ params }) => new Set<string>(params.documents?.some((d) => d.library) ? (await this.projectManager.libraryUpdates(params.project)).map((u) => u.document.id) : []),
  });

  constructor() {
    effect(() => this.thumbnails.document.set(this.documentId() ? asDocumentId(this.documentId() as string) : undefined));
    // A project opened without a document shows its most recently edited one.
    effect(() => {
      const documents = this.documents.value();
      if (this.documentId() || !documents?.length) return;
      const latest = [...documents].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0];
      if (latest) void this.open(latest, true);
    });
    // The project's documents and actions in the command palette.
    const shortcuts = inject(Shortcuts);
    let withdraw = (): void => undefined;
    effect(() => {
      const documents = this.documents.value() ?? [];
      withdraw();
      withdraw = shortcuts.registerActions([
        ...documents.map((d) => ({ label: d.name, group: kindLabels[d.kind], run: () => void this.open(d) })),
        { label: 'New component', group: 'Project', run: () => void this.create('component') },
        { label: 'New assembly', group: 'Project', run: () => void this.create('assembly') },
        { label: 'New drawing', group: 'Project', run: () => void this.create('drawing') },
        { label: 'Sync with git', group: 'Project', run: () => this.openSync() },
        ...documents.filter((d) => d.id === this.documentId()).map((d) => ({ label: `Versions of ${d.name}`, group: 'Project', run: () => void this.history().open(d) })),
        { label: 'About CADence', group: 'CADence', run: () => this.aboutDialog().open() },
      ]);
    });
    inject(DestroyRef).onDestroy(() => withdraw());
    // Documents and the project changed in other tabs, windows and programs (an agent's MCP server: CAD-150).
    const stop = this.projectManager.watch((change) => {
      if (change.kind === 'projects' && change.projectId && change.projectId !== this.projectId()) return;
      if (change.kind === 'document' && change.gone && change.documentId === this.documentId()) void this.router.navigate(['/projects', this.projectId()]);
      this.refresh();
    });
    inject(DestroyRef).onDestroy(stop);
  }

  protected openNotes(): void {
    const project = this.project.value();
    if (project) void this.notes().open(project);
  }

  protected async updatePart(document: DocumentSummary): Promise<void> {
    const result = await this.projectManager.updateLibraryParts(document.projectId, [document.id]);
    this.message.set(result.ok ? undefined : result.error.message);
    this.refresh();
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

  /** A document a mode made (a simplified mesh): listed and opened. */
  protected async opened(document: DocumentSummary): Promise<void> {
    this.message.set(undefined);
    this.refresh();
    await this.open(document);
  }

  protected async duplicate(document: DocumentSummary): Promise<void> {
    const result = await this.projectManager.duplicateDocument(document.id);
    if (!result.ok) return this.message.set(result.error.message);
    this.message.set(undefined);
    this.refresh();
    await this.open(result.value);
  }

  protected async replace(document: DocumentSummary, file: File): Promise<void> {
    const result = await this.projectManager.replaceImported(document.id, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    this.message.set(result.ok ? undefined : result.error.message);
    this.refresh();
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
      message: 'The document goes to the trash, where it stays for 30 days with its history. Restore it from the trash on the home page.',
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

  protected openSync(): void {
    const project = this.project.value();
    if (project) this.syncDialog().open(project);
  }

  private open(document: DocumentSummary, replaceUrl = false): Promise<boolean> {
    return this.router.navigate(['/projects', document.projectId, 'documents', document.id], { replaceUrl });
  }

  protected refresh(): void {
    this.documents.reload();
    this.project.reload();
  }
}
