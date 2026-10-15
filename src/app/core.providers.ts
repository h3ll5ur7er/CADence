import { type EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Core, StorageKind } from '@core/composition';
import type { DesignManager } from '@core/managers/design';
import type { ProjectManager } from '@core/managers/project';

/** Clients reach the system only through managers (docs/Architecture.md#call-rules). */
export const PROJECT_MANAGER = new InjectionToken<ProjectManager>('ProjectManager');
export const DESIGN_MANAGER = new InjectionToken<DesignManager>('DesignManager');

/** Where projects are kept, for display. */
export const STORAGE_KIND = new InjectionToken<StorageKind>('StorageKind');

export function provideCore(core: Core): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PROJECT_MANAGER, useValue: core.projectManager },
    { provide: DESIGN_MANAGER, useValue: core.designManager },
    { provide: STORAGE_KIND, useValue: core.storage },
  ]);
}
