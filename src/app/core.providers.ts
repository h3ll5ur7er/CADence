import { type EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Core, StorageKind } from '@core/composition';
import type { AssemblyManager } from '@core/managers/assembly';
import type { DesignManager } from '@core/managers/design';
import type { DrawingManager } from '@core/managers/drawing';
import type { ProjectManager } from '@core/managers/project';

/** Clients reach the system only through managers (docs/Architecture.md#call-rules). */
export const PROJECT_MANAGER = new InjectionToken<ProjectManager>('ProjectManager');
export const DESIGN_MANAGER = new InjectionToken<DesignManager>('DesignManager');
export const ASSEMBLY_MANAGER = new InjectionToken<AssemblyManager>('AssemblyManager');
export const DRAWING_MANAGER = new InjectionToken<DrawingManager>('DrawingManager');

/** Where projects are kept, for display. */
export const STORAGE_KIND = new InjectionToken<StorageKind>('StorageKind');

export function provideCore(core: Core): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PROJECT_MANAGER, useValue: core.projectManager },
    { provide: DESIGN_MANAGER, useValue: core.designManager },
    { provide: ASSEMBLY_MANAGER, useValue: core.assemblyManager },
    { provide: DRAWING_MANAGER, useValue: core.drawingManager },
    { provide: STORAGE_KIND, useValue: core.storage },
  ]);
}
