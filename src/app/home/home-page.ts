import { ChangeDetectionStrategy, Component, DestroyRef, inject, resource, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ProjectId, ProjectSummary, ProjectTemplate, TrashItem } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { importAccept } from '../editor/documents-panel';
import { ConfirmDialog, ExportProjectDialog, NameDialog } from '../shared/dialogs';
import { carriesFiles, droppedFiles } from '../shared/drop';
import { FileOpener } from '../shared/file-opener';
import { plural, relativeTime } from '../shared/format';
import { Thumbnail } from '../shared/thumbnail';
import { Icon } from '../shared/icon';
import { AboutDialog } from '../about/about-dialog';
import { HelpLink } from '../shared/help';
import { Layout } from '../shared/layout';
import { Tour } from '../shared/tour';
import { NewProjectDialog, templatePicture, type TemplateEntry } from './new-project-dialog';
import { OpenRemoteDialog } from './open-remote-dialog';
import { SharedProjectsDialog } from './shared-projects-dialog';

@Component({
  selector: 'cad-home-page',
  imports: [RouterLink, Icon, NameDialog, ConfirmDialog, ExportProjectDialog, NewProjectDialog, Thumbnail, OpenRemoteDialog, SharedProjectsDialog, AboutDialog, HelpLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  private readonly projectManager = inject(PROJECT_MANAGER);
  private readonly router = inject(Router);
  private readonly nameDialog = viewChild.required(NameDialog);
  private readonly confirmDialog = viewChild.required(ConfirmDialog);
  private readonly exportDialog = viewChild.required(ExportProjectDialog);
  private readonly newProjectDialog = viewChild.required(NewProjectDialog);
  private readonly opener = inject(FileOpener);
  protected readonly accept = `.cadence,${importAccept}`;
  protected readonly message = signal<string | undefined>(undefined);
  /** Files are dragged over the projects. */
  protected readonly dropping = signal(false);

  protected readonly projects = resource({ loader: () => this.projectManager.listProjects() });
  /** Deleted projects and documents, kept for 30 days (CAD-148). */
  protected readonly trash = resource({ loader: () => this.projectManager.listTrash() });
  protected readonly trashOpen = signal(false);
  protected readonly kinds = { component: 'component', assembly: 'assembly', drawing: 'drawing', imported: 'imported file' } as const;

  /** The sample projects (the templates the app ships), to open as projects of one's own (CAD-181). */
  protected readonly samples = resource({ loader: () => this.templates() });
  protected readonly picture = templatePicture;
  /** A sample is being made into a project. */
  protected readonly opening = signal(false);
  protected readonly tour = inject(Tour);
  /** Phones view; the tour of modelling is left out there (CAD-179). */
  protected readonly layout = inject(Layout);

  constructor() {
    // The first start offers the tour of a first part.
    this.tour.offer();
    // Projects other windows and programs (an agent's MCP server) change show here too (CAD-150).
    const stop = this.projectManager.watch(() => this.reload());
    inject(DestroyRef).onDestroy(stop);
  }

  private reload(): void {
    this.projects.reload();
    this.trash.reload();
  }

  protected async restore(item: TrashItem): Promise<void> {
    const result = await this.projectManager.restoreFromTrash(item.id);
    this.message.set(result.ok ? undefined : result.error.message);
    this.reload();
  }

  protected async deleteForGood(item: TrashItem): Promise<void> {
    const confirmed = await this.confirmDialog().confirm({
      heading: `Delete “${item.name}” for good?`,
      message: item.kind === 'project' ? 'The project, its documents and its version history are deleted from this device. It cannot be undone.' : 'The document cannot be restored from the trash any more; earlier versions stay in the project’s history.',
      confirmLabel: 'Delete for good',
    });
    if (!confirmed) return;
    const result = await this.projectManager.deleteFromTrash(item.id);
    this.message.set(result.ok ? undefined : result.error.message);
    this.reload();
  }

  protected async emptyTrash(): Promise<void> {
    const confirmed = await this.confirmDialog().confirm({ heading: 'Empty the trash?', message: 'Everything in the trash is deleted from this device. It cannot be undone.', confirmLabel: 'Empty trash' });
    if (!confirmed) return;
    await this.projectManager.emptyTrash();
    this.reload();
  }
  /** A project's picture: its most recently changed document's. */
  protected readonly pictureOf = (id: ProjectId) => () => this.projectManager.projectThumbnail(id);
  protected readonly plural = plural;
  protected readonly relativeTime = relativeTime;

  protected async createProject(): Promise<void> {
    const choice = await this.newProjectDialog().ask(await this.templates());
    if (!choice) return;
    const result = choice.template
      ? await this.projectManager.createFromTemplate({ ...(await this.fetchJson<ProjectTemplate>(`templates/${choice.template}.json`)), name: choice.name })
      : await this.projectManager.createProject(choice.name);
    if (!result.ok) return this.failed(result.error.message);
    const { project, firstDocument } = result.value;
    await this.router.navigate(['/projects', project.id, 'documents', firstDocument.id]);
  }

  /** Makes a project of a sample, named after it, and opens it. */
  protected async openSample(sample: TemplateEntry): Promise<void> {
    this.opening.set(true);
    try {
      const result = await this.projectManager.createFromTemplate({ ...(await this.fetchJson<ProjectTemplate>(`templates/${sample.id}.json`)), name: sample.name });
      if (!result.ok) return this.failed(result.error.message);
      const { project, firstDocument } = result.value;
      await this.router.navigate(['/projects', project.id, 'documents', firstDocument.id]);
    } catch (error) {
      this.failed(error instanceof Error ? error.message : String(error));
    } finally {
      this.opening.set(false);
    }
  }

  /** The templates the app ships (public/templates, made by src/automation/templates.ts). */
  private async templates(): Promise<readonly TemplateEntry[]> {
    try {
      return await this.fetchJson<TemplateEntry[]>('templates/index.json');
    } catch {
      return [];
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(new URL(path, document.baseURI));
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return (await response.json()) as T;
  }

  protected picked(input: HTMLInputElement): void {
    const files = [...(input.files ?? [])];
    input.value = '';
    void this.openFiles(files);
  }

  protected dragOver(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    this.dropping.set(true);
  }

  protected dropped(event: DragEvent): void {
    this.dropping.set(false);
    if (!carriesFiles(event)) return;
    event.preventDefault();
    void this.openFiles(droppedFiles(event));
  }

  private async openFiles(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    const result = await this.opener.open(await Promise.all(files.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))));
    if (!result.ok) return this.failed(result.error.message);
    this.message.set(undefined);
    if (result.value) await this.router.navigate(['/projects', result.value.id]);
  }

  private failed(message: string): void {
    this.message.set(message);
    this.projects.reload();
  }

  protected async duplicate(project: ProjectSummary): Promise<void> {
    const result = await this.projectManager.duplicateProject(project.id);
    this.message.set(result.ok ? undefined : result.error.message);
    this.projects.reload();
  }

  protected async exportProject(project: ProjectSummary): Promise<void> {
    const options = await this.exportDialog().ask(project.name);
    if (!options) return;
    const result = await this.projectManager.exportProject(project.id, options);
    this.message.set(result.ok ? undefined : result.error.message);
  }

  protected async openProject(project: ProjectSummary): Promise<void> {
    await this.router.navigate(['/projects', project.id]);
  }

  protected async rename(project: ProjectSummary): Promise<void> {
    const name = await this.nameDialog().ask({
      heading: 'Rename project',
      confirmLabel: 'Rename',
      initial: project.name,
    });
    if (!name || name === project.name) return;
    await this.projectManager.renameProject(project.id, name);
    this.projects.reload();
  }

  protected async delete(project: ProjectSummary): Promise<void> {
    const confirmed = await this.confirmDialog().confirm({
      heading: `Delete “${project.name}”?`,
      message: `The project and its ${plural(project.documentCount, 'document')} go to the trash, where they stay for 30 days.`,
      confirmLabel: 'Delete project',
    });
    if (!confirmed) return;
    await this.projectManager.deleteProject(project.id);
    this.reload();
  }
}
