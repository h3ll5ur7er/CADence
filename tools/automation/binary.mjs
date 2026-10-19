// Builds CADence's command line and MCP server as one self-contained executable for this platform
// (CAD-131): dist/binary/cadence-cli (cadence-cli.exe on Windows). It is a Node single executable
// application: a copy of this Node with the program, the kernels' WebAssembly and the fonts inside,
// so it runs anywhere without Node, node_modules or this repository.
// With --sidecar it is also copied to src-tauri/binaries/ under the name Tauri bundles it by
// (cadence-cli-<target triple>), for the desktop installers (CAD-132).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { bundleAutomation, pathOf } from './build.mjs';

const require = createRequire(import.meta.url);
const out = pathOf('dist/binary/');
const work = join(out, 'build');
const windows = process.platform === 'win32';
const executable = join(out, windows ? 'cadence-cli.exe' : 'cadence-cli');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. The program as one CommonJS script with every package inside (a single executable's main
//    script can load only Node's own modules).
const script = join(work, 'cadence.cjs');
await bundleAutomation({
  outfile: script,
  format: 'cjs',
  target: 'node24',
  // import.meta has no meaning in CommonJS: the script's own file instead.
  define: { 'import.meta.url': '__cadenceUrl' },
  banner: { js: 'var __cadenceUrl = typeof __filename === "string" ? require("node:url").pathToFileURL(__filename).href : "file:///cadence.cjs";' },
});

// 2. The blob Node runs: the script and what it unpacks on first start (src/automation/binary.ts).
const font = (file) => require.resolve(`@fontsource/inter/files/${file}`);
const assets = {
  // Next to the packages' main files (their exports name no WebAssembly).
  'replicad_single.wasm': join(dirname(require.resolve('replicad-opencascadejs')), 'replicad_single.wasm'),
  'planegcs.wasm': join(dirname(require.resolve('@salusoft89/planegcs')), 'planegcs_dist', 'planegcs.wasm'),
  'inter-latin-400-normal.woff': font('inter-latin-400-normal.woff'),
  'inter-latin-700-normal.woff': font('inter-latin-700-normal.woff'),
  'cadence.cjs': script,
};
const config = join(work, 'sea-config.json');
const blob = join(work, 'cadence.blob');
writeFileSync(config, JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets }, null, 2));
execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

// 3. A copy of this Node with the blob injected.
copyFileSync(process.execPath, executable);
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', executable]);
execFileSync(process.execPath, [
  require.resolve('postject/dist/cli.js'),
  executable,
  'NODE_SEA_BLOB',
  blob,
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', executable]);
rmSync(work, { recursive: true, force: true });
console.log(`${executable} (${Math.round(statSync(executable).size / 1e6)} MB)`);

if (process.argv.includes('--sidecar')) {
  const triple = /^host: (\S+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
  if (!triple) throw new Error('rustc does not say which platform it builds for.');
  mkdirSync(pathOf('src-tauri/binaries/'), { recursive: true });
  const sidecar = pathOf(`src-tauri/binaries/cadence-cli-${triple}${windows ? '.exe' : ''}`);
  copyFileSync(executable, sidecar);
  console.log(sidecar);
}
