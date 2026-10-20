// Builds the CADence server (server/) into one Node module: dist/server/server.mjs (docs/Architecture/Server.md).
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pathOf = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

await build({
  entryPoints: [pathOf('server/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: pathOf('tsconfig.server.json'),
  outfile: pathOf('dist/server/server.mjs'),
  logLevel: 'warning',
});
