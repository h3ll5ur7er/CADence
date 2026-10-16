import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the repository tools
import { collect, outputs, render } from './licences.mjs';

describe('licence credits', () => {
  const generated = render(collect()) as { credits: string; texts: string };

  it('are current (run `node tools/licences/licences.mjs` after changing dependencies)', () => {
    expect(readFileSync(outputs.credits, 'utf8').replace(/\r\n/g, '\n')).toBe(generated.credits);
    expect(readFileSync(outputs.texts, 'utf8').replace(/\r\n/g, '\n')).toBe(generated.texts);
  });

  it('credit the kernel, the solver and the font with their licences', () => {
    expect(generated.credits).toMatch(/"name": "replicad-opencascadejs",\n\s+"version": "[^"]+",\n\s+"license": "LGPL-2.1-only"/);
    expect(generated.credits).toMatch(/"name": "@salusoft89\/planegcs",\n\s+"version": "[^"]+",\n\s+"license": "LGPL-2.0-or-later"/);
    expect(generated.texts).toContain('SIL OPEN FONT LICENSE');
  });
});
