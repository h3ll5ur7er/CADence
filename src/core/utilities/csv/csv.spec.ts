import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from '.';

describe('csv', () => {
  it('writes and reads back fields with separators, quotes and line breaks', () => {
    const rows = [
      ['Configuration', 'width'],
      ['Big, wide', '2 * "a"'],
      ['Two\nlines', ''],
    ];
    expect(toCsv(rows)).toBe('Configuration,width\r\n"Big, wide","2 * ""a"""\r\n"Two\nlines",\r\n');
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('reads semicolons as spreadsheets write them, and skips blank lines', () => {
    expect(parseCsv('\uFEFFname;width\n\nSmall;40 mm\n')).toEqual([
      ['name', 'width'],
      ['Small', '40 mm'],
    ]);
  });
});
