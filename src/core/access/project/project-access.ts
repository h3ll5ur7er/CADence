import type { Project, ProjectId } from '@core/contracts';

/** Atomic business verbs over the project store. */
export interface ProjectAccess {
  enumerate(): Promise<Project[]>;
  find(id: ProjectId): Promise<Project | undefined>;
  /** Adds a new project; fails if the id exists. */
  establish(project: Project): Promise<void>;
  /** Replaces an existing project's record (name, modification time); fails if unknown. */
  revise(project: Project): Promise<void>;
  /** Removes the project record; unknown ids are ignored. */
  discard(id: ProjectId): Promise<void>;
}

export class UnknownProjectError extends Error {
  constructor(id: ProjectId) {
    super(`Unknown project ${id}`);
  }
}

export class DuplicateProjectError extends Error {
  constructor(id: ProjectId) {
    super(`Project ${id} already exists`);
  }
}
