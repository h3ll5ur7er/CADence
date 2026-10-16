/**
 * A small PDF writer (PDF 1.4): pages of text in the standard Helvetica fonts, lines, rectangles and
 * JPEG pictures. Coordinates are points (1/72 in) from the page's bottom left. Enough for assembly
 * instructions and drawing sheets, with no dependency.
 */

export type PdfOp =
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly size: number; readonly text: string; readonly bold?: boolean; readonly align?: 'left' | 'right' | 'center' }
  | { readonly kind: 'line'; readonly points: readonly (readonly [number, number])[]; readonly width?: number; readonly dash?: readonly number[]; readonly gray?: number; readonly closed?: boolean }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly fill?: number; readonly stroke?: number }
  | { readonly kind: 'image'; readonly image: number; readonly x: number; readonly y: number; readonly width: number; readonly height: number };

export interface PdfPage {
  readonly width: number;
  readonly height: number;
  readonly ops: readonly PdfOp[];
}

/** A JPEG picture (its bytes as they are) and its size in pixels. */
export interface PdfImage {
  readonly jpeg: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** Page sizes in points. */
export const pageSizes = {
  a4: { width: 595.28, height: 841.89 },
  a3: { width: 841.89, height: 1190.55 },
} as const;

export const mmToPt = (mm: number) => (mm * 72) / 25.4;

// Helvetica advance widths (1/1000 em) for 32 … 126; other characters count as 556.
const helvetica = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222,
  833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const helveticaBold = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278,
  889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** How wide a text is in points. */
export function textWidth(text: string, size: number, bold = false): number {
  const widths = bold ? helveticaBold : helvetica;
  let total = 0;
  for (const c of text) total += widths[(c.codePointAt(0) ?? 0) - 32] ?? 556;
  return (total * size) / 1000;
}

// WinAnsi codes of the characters beyond Latin-1 that a document is likely to use.
const winAnsi: Readonly<Record<string, number>> = { '€': 0x80, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '⌀': 0xd8 };

/** A text as a hex string in WinAnsi encoding; characters it does not have become "?". */
function hexText(text: string): string {
  let hex = '';
  for (const c of text) {
    const code = c.codePointAt(0) ?? 63;
    const byte = winAnsi[c] ?? ((code >= 32 && code < 127) || (code >= 0xa0 && code <= 0xff) ? code : 63);
    hex += byte.toString(16).padStart(2, '0');
  }
  return `<${hex}>`;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

function content(page: PdfPage): string {
  const lines: string[] = [];
  for (const op of page.ops) {
    switch (op.kind) {
      case 'text': {
        const width = textWidth(op.text, op.size, op.bold);
        const x = op.align === 'right' ? op.x - width : op.align === 'center' ? op.x - width / 2 : op.x;
        lines.push(`BT /${op.bold ? 'F2' : 'F1'} ${n(op.size)} Tf ${n(x)} ${n(op.y)} Td ${hexText(op.text)} Tj ET`);
        break;
      }
      case 'line': {
        const [first, ...rest] = op.points;
        if (!first) break;
        lines.push(`${n(op.width ?? 0.5)} w ${n(op.gray ?? 0)} G [${(op.dash ?? []).map(n).join(' ')}] 0 d`);
        lines.push(`${n(first[0])} ${n(first[1])} m ${rest.map((p) => `${n(p[0])} ${n(p[1])} l`).join(' ')} ${op.closed ? 's' : 'S'}`);
        break;
      }
      case 'rect':
        if (op.fill !== undefined) lines.push(`${n(op.fill)} g ${n(op.x)} ${n(op.y)} ${n(op.width)} ${n(op.height)} re f`);
        if (op.stroke !== undefined) lines.push(`0.5 w ${n(op.stroke)} G [] 0 d ${n(op.x)} ${n(op.y)} ${n(op.width)} ${n(op.height)} re S`);
        lines.push('0 g');
        break;
      case 'image':
        lines.push(`q ${n(op.width)} 0 0 ${n(op.height)} ${n(op.x)} ${n(op.y)} cm /Im${op.image} Do Q`);
        break;
    }
  }
  return lines.join('\n');
}

const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);

/** The document as PDF bytes. */
export function pdfDocument(pages: readonly PdfPage[], images: readonly PdfImage[] = [], title = ''): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const write = (bytes: Uint8Array) => {
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    write(latin1(`${id} 0 obj\n${body}\n`));
    if (stream) {
      write(latin1('stream\n'));
      write(stream);
      write(latin1('\nendstream\n'));
    }
    write(latin1('endobj\n'));
  };
  write(latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  // 1 catalog, 2 pages, 3–4 fonts, 5 info, then images, then each page and its content.
  const firstImage = 6;
  const firstPage = firstImage + images.length;
  const pageIds = pages.map((_, i) => firstPage + i * 2);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  object(5, `<< /Title ${hexText(title)} /Producer (CADence) >>`);
  images.forEach((image, i) =>
    object(firstImage + i, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>`, image.jpeg),
  );
  const xObjects = images.map((_, i) => `/Im${i} ${firstImage + i} 0 R`).join(' ');
  pages.forEach((page, i) => {
    const id = pageIds[i] as number;
    const stream = latin1(content(page));
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(page.width)} ${n(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xObjects} >> >> /Contents ${id + 1} 0 R >>`,
    );
    object(id + 1, `<< /Length ${stream.length} >>`, stream);
  });
  const count = firstPage + pages.length * 2;
  const xref = length;
  write(latin1(`xref\n0 ${count}\n0000000000 65535 f \n${Array.from({ length: count - 1 }, (_, i) => `${String(offsets[i + 1] ?? 0).padStart(10, '0')} 00000 n \n`).join('')}`));
  write(latin1(`trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
