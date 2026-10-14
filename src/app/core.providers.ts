import { type EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import type { Core } from '@core/composition';
import type { ProjectManager } from '@core/managers/project';

/** Clients reach the system only through managers (docs/Architecture.md#call-rules). */
export const PROJECT_MANAGER = new InjectionToken<ProjectManager>('ProjectManager');

export function provideCore(core: Core): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: PROJECT_MANAGER, useValue: core.projectManager }]);
}
