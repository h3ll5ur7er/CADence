import { ChangeDetectionStrategy, Component, inject, resource, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ProjectId, ProjectSummary } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { ConfirmDialog, NameDialog } from '../shared/dialogs';
import { plural, relativeTime } from '../shared/format';
import { Thumbnail } from '../shared/thumbnail';
import { Icon } from '../shared/icon';
import { AboutDialog } from '../about/about-dialog';
import { OpenRemoteDialog } from './open-remote-dialog';

@Component({
  selector: 'cad-home-page',
  imports: [RouterLink, Icon, NameDialog, ConfirmDialog, Thumbnail, OpenRemoteDialog, AboutDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.html',
  styleUrl: './home-page.scss',
})
export class HomePage {
  private readonly projectManager = inject(PROJECT_MANAGER);
  private readonly router = inject(Router);
  private readonly nameDialog = viewChild.required(NameDialog);
  private readonly confirmDialog = viewChild.required(ConfirmDialog);

  protected readonly projects = resource({ loader: () => this.projectManager.listProjects() });
  /** A project's picture: its most recently changed document's. */
  protected readonly pictureOf = (id: ProjectId) => () => this.projectManager.projectThumbnail(id);
  protected readonly plural = plural;
  protected readonly relativeTime = relativeTime;

  protected async createProject(): Promise<void> {
    const name = await this.nameDialog().ask({
      heading: 'New project',
      confirmLabel: 'Create project',
      initial: 'Untitled project',
    });
    if (!name) return;
    const result = await this.projectManager.createProject(name);
    if (!result.ok) return;
    const { project, firstDocument } = result.value;
    await this.router.navigate(['/projects', project.id, 'documents', firstDocument.id]);
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
      message: `This deletes the project and its ${plural(project.documentCount, 'document')} from this device. It cannot be undone.`,
      confirmLabel: 'Delete project',
    });
    if (!confirmed) return;
    await this.projectManager.deleteProject(project.id);
    this.projects.reload();
  }
}
