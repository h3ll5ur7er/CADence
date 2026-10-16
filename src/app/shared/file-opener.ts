import { Injectable, InjectionToken, inject } from '@angular/core';
import type { ProjectSummary, Result } from '@core/contracts';
import { PROJECT_MANAGER } from '../core.providers';
import { isArchive } from './drop';

/** A file to open: its name and contents. */
export interface FileToOpen {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** The files the app was started with (desktop: Open with CADence); none in the browser. */
export const OPENED_FILES = new InjectionToken<() => Promise<FileToOpen[]>>('Opened files', { factory: () => async () => [] });

/**
 * Opens files as projects: project archives as they are, other files (STEP, STL, DXF, …) in a new
 * project named after the first of them.
 */
@Injectable({ providedIn: 'root' })
export class FileOpener {
  private readonly projects = inject(PROJECT_MANAGER);

  /** The project opened last; undefined without files. */
  async open(files: readonly FileToOpen[]): Promise<Result<ProjectSummary | undefined>> {
    let opened: ProjectSummary | undefined;
    for (const archive of files.filter(isArchive)) {
      const result = await this.projects.importProject(archive);
      if (!result.ok) return result;
      opened = result.value;
    }
    const others = files.filter((file) => !isArchive(file));
    const [first] = others;
    if (first) {
      const created = await this.projects.createProject(first.name.replace(/\.[^.]+$/, ''));
      if (!created.ok) return created;
      for (const file of others) {
        const imported = await this.projects.importFile(created.value.project.id, file);
        if (!imported.ok) return imported;
      }
      // A project of files needs no empty component.
      await this.projects.deleteDocument(created.value.firstDocument.id);
      opened = created.value.project;
    }
    return { ok: true, value: opened };
  }
}
