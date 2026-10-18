import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAsset, isSea } from 'node:sea';
import type { NodeResources } from '@core/composition/node';

/**
 * The files the self-contained binary carries besides Node (CAD-131, tools/automation/binary.mjs):
 * the kernels' WebAssembly, the fonts, and this program as a script, for the views worker.
 */
export const binaryAssets = {
  kernel: 'replicad_single.wasm',
  solver: 'planegcs.wasm',
  regular: 'inter-latin-400-normal.woff',
  bold: 'inter-latin-700-normal.woff',
  script: 'cadence.cjs',
} as const;

/**
 * In the self-contained binary: its files, unpacked once into a folder of the temporary directory
 * named after the program's hash (so builds never mix), and where they are. Otherwise nothing: the
 * files come from their packages.
 */
export function unpacked(): { readonly resources: NodeResources; readonly script: string } | undefined {
  if (!isSea()) return undefined;
  const script = new Uint8Array(getAsset(binaryAssets.script));
  const folder = join(tmpdir(), `cadence-${createHash('sha256').update(script).digest('hex').slice(0, 12)}`);
  mkdirSync(folder, { recursive: true });
  const path = (name: string) => {
    const file = join(folder, name);
    if (!existsSync(file)) {
      // Written whole, then renamed: another process starting at once never reads half a file.
      const part = `${file}.${process.pid}.part`;
      writeFileSync(part, name === binaryAssets.script ? script : new Uint8Array(getAsset(name)));
      renameSync(part, file);
    }
    return file;
  };
  return {
    resources: { kernel: path(binaryAssets.kernel), solver: path(binaryAssets.solver), fonts: { regular: path(binaryAssets.regular), bold: path(binaryAssets.bold) } },
    script: path(binaryAssets.script),
  };
}
