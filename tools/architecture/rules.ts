/**
 * iDesign call rules (docs/Architecture.md#call-rules) as data plus a pure checker.
 * Paths are repository-relative and use forward slashes.
 */

export type Layer =
  | 'client'
  | 'manager'
  | 'engine'
  | 'access'
  | 'utility'
  | 'contracts'
  | 'composition'
  | 'worker'
  | 'host';

export interface Element {
  readonly layer: Layer;
  /** Component name inside the layer, e.g. `project` for `src/core/managers/project`. */
  readonly component: string;
}

/** Layers each layer may call besides itself. Calls inside one component are always allowed. */
const allowedTargets: Readonly<Record<Layer, readonly Layer[]>> = {
  client: ['client', 'manager', 'contracts', 'utility', 'composition'],
  manager: ['engine', 'access', 'contracts', 'utility'],
  engine: ['access', 'contracts', 'utility'],
  access: ['contracts', 'utility'],
  utility: ['utility'],
  contracts: [],
  composition: ['manager', 'engine', 'access', 'utility', 'contracts'],
  worker: ['engine', 'access', 'utility', 'contracts', 'composition'],
  host: ['client', 'manager', 'engine', 'access', 'utility', 'contracts', 'composition', 'worker'],
};

/** Packages the framework-free core must never depend on. */
const forbiddenInCore = [/^@angular\//, /^three(\/|$)/, /^@tauri-apps\//];
const coreLayers: readonly Layer[] = ['manager', 'engine', 'access', 'utility', 'contracts'];

const componentLayers: Readonly<Record<string, Layer>> = {
  managers: 'manager',
  engines: 'engine',
  access: 'access',
  utilities: 'utility',
};

export function classify(path: string): Element | null {
  if (path.startsWith('src/app/')) return { layer: 'client', component: 'app' };
  if (path.startsWith('src/workers/')) return { layer: 'worker', component: 'workers' };
  const core = /^src\/core\/([^/]+)\/(?:([^/]+)\/)?/.exec(path);
  if (core) {
    const [, folder = '', name = ''] = core;
    if (folder === 'contracts') return { layer: 'contracts', component: 'contracts' };
    if (folder === 'composition') return { layer: 'composition', component: 'composition' };
    const layer = componentLayers[folder];
    if (layer && name) return { layer, component: name };
    return null;
  }
  if (path.startsWith('src/')) return { layer: 'host', component: 'host' };
  return null;
}

/** The public entry point of the component that contains `path`. */
function entryPointOf(path: string, element: Element): string {
  const depth = element.layer === 'contracts' || element.layer === 'composition' ? 3 : 4;
  return `${path.split('/').slice(0, depth).join('/')}/index.ts`;
}

const isTestFile = (path: string) => path.endsWith('.spec.ts') || path.includes('/testing/');

/** A component's `testing/` folder is a second entry point, open to tests only. */
function isTestSupport(from: string, to: string, target: Element): boolean {
  const entry = entryPointOf(to, target).replace(/index\.ts$/, 'testing/');
  return isTestFile(from) && to.startsWith(entry);
}

/** Returns a human-readable violation, or null when the import is allowed. */
export function checkImport(from: string, to: string): string | null {
  const source = classify(from);
  if (!source) return null;
  const target = classify(to);
  if (!target) return null;
  const sameComponent = source.layer === target.layer && source.component === target.component;
  if (sameComponent) return null;
  if (!allowedTargets[source.layer].includes(target.layer)) {
    return `${from}: ${source.layer} '${source.component}' must not call ${target.layer} '${target.component}' (${to})`;
  }
  const isCoreTarget = coreLayers.includes(target.layer) || target.layer === 'composition';
  if (isCoreTarget && to !== entryPointOf(to, target) && !isTestSupport(from, to, target)) {
    return `${from}: import ${target.layer} '${target.component}' through its index.ts, not ${to}`;
  }
  return null;
}

export function checkPackage(from: string, specifier: string): string | null {
  const source = classify(from);
  if (!source || !coreLayers.includes(source.layer)) return null;
  return forbiddenInCore.some((p) => p.test(specifier))
    ? `${from}: the core must not depend on '${specifier}'`
    : null;
}
