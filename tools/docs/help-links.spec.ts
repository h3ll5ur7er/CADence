import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorOf, helpTopics, helpUrl, userGuide } from '../../src/app/shared/help-topics';

/** The help links of tools and dialogs (CAD-181) lead to a page of the User guide and a heading on it. */
describe('help links', () => {
  const guide = join(import.meta.dirname, '..', '..', 'docs', 'User-guide');

  it.each(Object.entries(helpTopics))('%s points at a heading of the User guide', (_topic, { page, heading }) => {
    const file = join(guide, `${page}.md`);
    expect(existsSync(file), `docs/User-guide/${page}.md`).toBe(true);
    const headings = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^#{2,4} /.test(line))
      .map((line) => line.replace(/^#+ /, '').trim());
    expect(headings).toContain(heading);
  });

  it('makes anchors as GitHub does', () => {
    expect(anchorOf('New projects, copies and files')).toBe('new-projects-copies-and-files');
    expect(anchorOf('Export for printing and CAD')).toBe('export-for-printing-and-cad');
    expect(helpUrl('measure')).toBe(`${userGuide}/Measuring-and-checking.md#measure`);
  });
});
