// Builds the command line and MCP server (src/automation) into one Node module: dist/automation/cadence.mjs.
// Packages stay external and load from node_modules (the geometry kernel finds its WebAssembly there).
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('../../', import.meta.url);
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

const { version } = JSON.parse(read('package.json'));

await build({
  entryPoints: [new URL('src/automation/main.ts', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  outfile: new URL('dist/automation/cadence.mjs', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  tsconfig: new URL('tsconfig.automation.json', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  banner: { js: '#!/usr/bin/env node' },
  define: { CADENCE_VERSION: JSON.stringify(version) },
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
});
