import type { Project, ProjectId } from '@core/contracts';
import { KeyValueDatabase } from '@core/utilities/indexed-db';
import { DuplicateProjectError, type ProjectAccess, UnknownProjectError } from './project-access';

const store = 'projects';

export class IndexedDbProjectAccess implements ProjectAccess {
  private readonly db: KeyValueDatabase;

  constructor(databaseName = 'cadence-projects', factory?: IDBFactory) {
    this.db = new KeyValueDatabase(databaseName, [{ name: store, keyPath: 'id' }], factory);
  }

  enumerate(): Promise<Project[]> {
    return this.db.getAll<Project>(store);
  }

  find(id: ProjectId): Promise<Project | undefined> {
    return this.db.get<Project>(store, id);
  }

  async establish(project: Project): Promise<void> {
    if (await this.find(project.id)) throw new DuplicateProjectError(project.id);
    await this.db.put(store, project);
  }

  async revise(project: Project): Promise<void> {
    if (!(await this.find(project.id))) throw new UnknownProjectError(project.id);
    await this.db.put(store, project);
  }

  discard(id: ProjectId): Promise<void> {
    return this.db.delete(store, id);
  }
}
