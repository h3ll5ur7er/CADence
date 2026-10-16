import { describe, expect, it } from 'vitest';
import { pageSizes, pdfDocument, textWidth } from '.';

const text = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('pdf', () => {
  it('writes pages with text, lines and pictures, and a cross-reference table that points at every object', () => {
    // The smallest JPEG-like bytes: the writer embeds them as they are.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
    const { width, height } = pageSizes.a4;
    const bytes = pdfDocument(
      [
        { width, height, ops: [{ kind: 'text', x: 40, y: 800, size: 18, text: 'Step 1 – fit the bracket (⌀6)', bold: true }, { kind: 'image', image: 0, x: 40, y: 400, width: 300, height: 200 }] },
        { width, height, ops: [{ kind: 'line', points: [[10, 10], [100, 100]], dash: [3, 2] }, { kind: 'rect', x: 5, y: 5, width: 50, height: 20, stroke: 0 }] },
      ],
      [{ jpeg, width: 2, height: 1 }],
      'Instructions',
    );
    const pdf = text(bytes);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('/Filter /DCTDecode');
    expect(pdf).toContain('/Im0 Do');
    // "–" and "⌀" are WinAnsi 0x96 and 0xD8.
    expect(pdf).toContain('96');
    expect(pdf).toContain('d8');
    const start = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    const table = pdf.slice(start).split('\n');
    const count = Number(table[1]?.split(' ')[1]);
    for (let id = 1; id < count; id++) {
      const offset = Number(table[2 + id]?.slice(0, 10));
      expect(pdf.slice(offset, offset + `${id} 0 obj`.length)).toBe(`${id} 0 obj`);
    }
  });

  it('measures Helvetica text for alignment', () => {
    expect(textWidth('ii', 10)).toBeCloseTo(4.44);
    expect(textWidth('W', 10, true)).toBeCloseTo(9.44);
  });
});
