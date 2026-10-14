import type { Project, ProjectId } from '@core/contracts';
import { type FileSystem, joinPath } from '@core/utilities/file-system';
import { DuplicateProjectError, type ProjectAccess, UnknownProjectError } from './project-access';

/** Desktop store: one folder per project, `projects/<id>/project.json` holds the record. */
export class FileSystemProjectAccess implements ProjectAccess {
  constructor(private readonly fs: FileSystem) {}

  async enumerate(): Promise<Project[]> {
    const projects = await Promise.all((await this.fs.list('projects')).map((id) => this.read(id)));
    return projects.filter((p): p is Project => p !== undefined);
  }

  find(id: ProjectId): Promise<Project | undefined> {
    return this.read(id);
  }

  async establish(project: Project): Promise<void> {
    if (await this.fs.exists(recordPath(project.id))) throw new DuplicateProjectError(project.id);
    await this.fs.makeDirectory(joinPath('projects', project.id));
    await this.write(project);
  }

  async revise(project: Project): Promise<void> {
    if (!(await this.fs.exists(recordPath(project.id)))) throw new UnknownProjectError(project.id);
    await this.write(project);
  }

  /** Removes the whole project folder; the folder is the project. */
  discard(id: ProjectId): Promise<void> {
    return this.fs.remove(joinPath('projects', id));
  }

  private async read(id: string): Promise<Project | undefined> {
    const path = recordPath(id);
    return (await this.fs.exists(path)) ? (JSON.parse(await this.fs.readText(path)) as Project) : undefined;
  }

  private write(project: Project): Promise<void> {
    return this.fs.writeText(recordPath(project.id), JSON.stringify(project, null, 2));
  }
}

const recordPath = (id: string) => joinPath('projects', id, 'project.json');
