import { type EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Core, StorageKind } from '@core/composition';
import type { ProjectManager } from '@core/managers/project';

/** Clients reach the system only through managers (docs/Architecture.md#call-rules). */
export const PROJECT_MANAGER = new InjectionToken<ProjectManager>('ProjectManager');

/** Where projects are kept, for display. */
export const STORAGE_KIND = new InjectionToken<StorageKind>('StorageKind');

export function provideCore(core: Core): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PROJECT_MANAGER, useValue: core.projectManager },
    { provide: STORAGE_KIND, useValue: core.storage },
  ]);
}
