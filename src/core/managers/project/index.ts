import { DefaultProjectManager, type ProjectManagerDependencies } from './default-project-manager';
import type { ProjectManager } from './project-manager';

export type { ProjectManagerDependencies } from './default-project-manager';
export type { AttachmentInput, CreatedProject, ExternalFile, ImportedView, LibraryUpdate, ProjectManager, SimplifiedImport, StoreChange } from './project-manager';

export function createProjectManager(dependencies: ProjectManagerDependencies): ProjectManager {
  return new DefaultProjectManager(dependencies);
}
