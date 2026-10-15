// Serves the built web app the way GitHub Pages does: below a sub-path, with 404.html for unknown paths.
// Used by the Pages journeys (playwright.pages.config.ts). Usage: node tools/pages/serve.mjs [port] [base]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.argv[2] ?? 4310);
const base = process.argv[3] ?? '/CADence/';
const root = 'dist/cadence/browser';
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const rest = path.startsWith(base) ? path.slice(base.length) : null;
  const relative = rest === null ? null : normalize(rest || 'index.html').replace(/^[/\\]+/, '');
  const file = relative === null ? null : join(root, relative);
  const found = file !== null && !relative?.startsWith('..') && existsSync(file) && statSync(file).isFile();
  const served = found ? file : join(root, '404.html');
  response.writeHead(found ? 200 : 404, { 'content-type': types[extname(served)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  createReadStream(served).pipe(response);
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}${base}`));
