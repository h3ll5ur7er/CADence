import type { Project, ProjectId } from '@core/contracts';
import { DuplicateProjectError, type ProjectAccess, UnknownProjectError } from './project-access';

export class InMemoryProjectAccess implements ProjectAccess {
  private readonly projects = new Map<ProjectId, Project>();

  async enumerate(): Promise<Project[]> {
    return [...this.projects.values()].map((p) => structuredClone(p));
  }

  async find(id: ProjectId): Promise<Project | undefined> {
    const project = this.projects.get(id);
    return project && structuredClone(project);
  }

  async establish(project: Project): Promise<void> {
    if (this.projects.has(project.id)) throw new DuplicateProjectError(project.id);
    this.projects.set(project.id, structuredClone(project));
  }

  async revise(project: Project): Promise<void> {
    if (!this.projects.has(project.id)) throw new UnknownProjectError(project.id);
    this.projects.set(project.id, structuredClone(project));
  }

  async discard(id: ProjectId): Promise<void> {
    this.projects.delete(id);
  }
}
