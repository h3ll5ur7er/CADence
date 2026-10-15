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
  | 'platform'
  | 'host';

export interface Element {
  readonly layer: Layer;
  /** Component name inside the layer, e.g. `project` for `src/core/managers/project`. */
  readonly component: string;
}

/** Layers each layer may call besides itself. Calls inside one component are always allowed. */
const allowedTargets: Readonly<Record<Layer, readonly Layer[]>> = {
  client: ['client', 'manager', 'contracts', 'utility', 'composition', 'platform'],
  manager: ['engine', 'access', 'contracts', 'utility'],
  engine: ['access', 'contracts', 'utility'],
  access: ['contracts', 'utility'],
  utility: ['utility'],
  contracts: [],
  composition: ['manager', 'engine', 'access', 'utility', 'contracts'],
  worker: ['engine', 'access', 'utility', 'contracts', 'composition'],
  /** Host adapters outside the core (e.g. Tauri): they implement access and utility ports. */
  platform: ['access', 'utility', 'contracts'],
  host: ['client', 'manager', 'engine', 'access', 'utility', 'contracts', 'composition', 'worker', 'platform'],
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
  if (path.startsWith('src/app/platform/')) return { layer: 'platform', component: 'platform' };
  // Scripts, the command line and the MCP server: clients of the core that run in Node.
  if (path.startsWith('src/automation/')) return { layer: 'client', component: 'automation' };
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

/** Code that only ever runs in Node: tests, the automation client and Node entry points themselves. */
const isNodeOnly = (path: string) => isTestFile(path) || path.startsWith('src/automation/') || path.endsWith('/node.ts');

/** A component's `node.ts` is its Node-only entry point (adapters over `node:fs` and the like), open to Node-only code. */
function isNodeEntry(from: string, to: string, target: Element): boolean {
  return isNodeOnly(from) && to === entryPointOf(to, target).replace(/index\.ts$/, 'node.ts');
}

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
  if (isCoreTarget && to !== entryPointOf(to, target) && !isTestSupport(from, to, target) && !isNodeEntry(from, to, target)) {
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

/** Code that runs on the main thread at start-up: clients, managers and the composition root. */
const mainThread = [/^src\/app\//, /^src\/core\/managers\//, /^src\/core\/composition\//];
/** The geometry kernel and what wraps it: 23 MB of WebAssembly that only the geometry worker loads. */
const kernelBound = [/^src\/core\/engines\/(modeling|interchange|analysis)\//, /^src\/core\/access\/shape\//, /^replicad(-opencascadejs)?$/];

/**
 * Main-thread code may use the kernel-bound engines' types, but never import their code: a value
 * import would pull the kernel into the start-up bundle (ADR-16). The composition root loads them
 * with dynamic `import()` where no worker is available.
 */
export function checkKernelImport(from: string, to: string): string | null {
  if (isTestFile(from) || !mainThread.some((p) => p.test(from))) return null;
  return kernelBound.some((p) => p.test(to)) ? `${from}: imports code of ${to} (the geometry kernel); import its types only` : null;
}
