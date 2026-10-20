// Builds the command line and MCP server (src/automation) into one Node module: dist/automation/cadence.mjs.
// Packages stay external and load from node_modules (the geometry kernel finds its WebAssembly there).
// binary.mjs builds the self-contained executable from the same bundle with every package inside.
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const root = new URL('../../', import.meta.url);
/** A path below the repository, as the file system wants it. */
export const pathOf = (path) => fileURLToPath(new URL(path, root));
const read = (path) => readFileSync(new URL(path, root), 'utf8');

/** The types an agent needs to write commands, without their imports, by topic: each small enough for an agent to read whole (CAD-111). */
const referenceTopics = {
  commands: ['src/core/managers/design/design-manager.ts', 'src/automation/shapes.ts'],
  sketch: ['src/core/contracts/sketch.ts'],
  features: ['src/core/contracts/feature.ts', 'src/core/contracts/parts.ts'],
  document: ['src/core/contracts/document.ts', 'src/core/contracts/analysis.ts', 'src/core/contracts/appearance.ts'],
  assembly: ['src/core/managers/assembly/assembly-manager.ts', 'src/core/contracts/assembly.ts'],
  drawing: ['src/core/managers/drawing/drawing-manager.ts', 'src/core/contracts/drawing.ts'],
};
const reference = Object.fromEntries(
  Object.entries(referenceTopics).map(([topic, files]) => [topic, files.map((path) => `// ${path}\n${read(path).replace(/^import[\s\S]*?;\n/gm, '').trim()}\n`).join('\n')]),
);

export const { version } = JSON.parse(read('package.json'));

/** Bundles src/automation/main.ts; `options` adds to or replaces esbuild's options (`define` adds to the version). */
export function bundleAutomation({ define, ...options }) {
  return build({
    entryPoints: [pathOf('src/automation/main.ts')],
    bundle: true,
    platform: 'node',
    tsconfig: pathOf('tsconfig.automation.json'),
    define: { CADENCE_VERSION: JSON.stringify(version), ...define },
    logLevel: 'warning',
    plugins: [
      {
        name: 'reference',
        setup(b) {
          b.onResolve({ filter: /^cadence:reference$/ }, () => ({ path: 'reference', namespace: 'cadence' }));
          b.onLoad({ filter: /.*/, namespace: 'cadence' }, () => ({ contents: JSON.stringify(reference), loader: 'json' }));
        },
      },
    ],
    ...options,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await bundleAutomation({ outfile: pathOf('dist/automation/cadence.mjs'), format: 'esm', target: 'node22', packages: 'external', banner: { js: '#!/usr/bin/env node' } });
}
