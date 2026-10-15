import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the repository tools
import { versions } from './version.mjs';

describe('the version', () => {
  it('is the same everywhere it is written (set it with `node tools/release/version.mjs <version>`)', () => {
    const all = versions() as Record<string, string>;
    expect(new Set(Object.values(all)), JSON.stringify(all)).toHaveLength(1);
    expect(all['package.json']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
