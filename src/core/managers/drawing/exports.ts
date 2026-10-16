import { mmToPt, type PdfOp, pdfDocument } from '@core/utilities/pdf';
import type { LineStyle, SheetLayout } from './drawing-manager';

/** Line widths (mm) and dash patterns (mm) by style, after ISO 128. */
const styles: Readonly<Record<LineStyle, { readonly width: number; readonly dash?: readonly number[] }>> = {
  visible: { width: 0.5 },
  hidden: { width: 0.25, dash: [3, 1.5] },
  thin: { width: 0.25 },
  center: { width: 0.25, dash: [8, 1.5, 1, 1.5] },
  frame: { width: 0.7 },
  hatch: { width: 0.18 },
};

/** The three corners of an arrowhead 3 mm long. */
export function arrowhead(tip: readonly [number, number], direction: readonly [number, number]): [number, number][] {
  const [dx, dy] = direction;
  const [back, side] = [3, 0.6];
  return [[tip[0], tip[1]], [tip[0] - dx * back - dy * side, tip[1] - dy * back + dx * side], [tip[0] - dx * back + dy * side, tip[1] - dy * back - dx * side]];
}

/** The sheet as a one-page PDF of its size. Text sizes are capital heights (mm). */
export function sheetPdf(layout: SheetLayout, title: string): Uint8Array {
  const pt = (p: readonly [number, number]): [number, number] => [mmToPt(p[0]), mmToPt(p[1])];
  const ops: PdfOp[] = [
    ...layout.paths.map((path): PdfOp => {
      const style = styles[path.style];
      return { kind: 'line', points: path.points.map(pt), width: mmToPt(style.width), ...(style.dash ? { dash: style.dash.map(mmToPt) } : {}), ...(path.closed ? { closed: true } : {}) };
    }),
    ...layout.arrows.map((a): PdfOp => ({ kind: 'line', points: arrowhead(a.tip, a.direction).map(pt), closed: true, fill: 0 })),
    // Helvetica's capitals are 0.72 em high.
    ...layout.texts.map((t): PdfOp => ({ kind: 'text', x: mmToPt(t.at[0]), y: mmToPt(t.at[1]), size: mmToPt(t.size) / 0.72, text: t.text, align: t.align, ...(t.bold ? { bold: true } : {}) })),
  ];
  return pdfDocument([{ width: mmToPt(layout.width), height: mmToPt(layout.height), ops }], [], title);
}

const layers: Readonly<Record<LineStyle, string>> = { visible: 'VISIBLE', hidden: 'HIDDEN', thin: 'DIMENSIONS', center: 'CENTER', frame: 'FRAME', hatch: 'HATCH' };
const num = (v: number) => (Math.round(v * 1e4) / 1e4).toString();
const pairs = (...items: (string | number)[]) => {
  const out: string[] = [];
  for (let i = 0; i < items.length; i += 2) out.push(String(items[i]), typeof items[i + 1] === 'number' ? num(items[i + 1] as number) : String(items[i + 1]));
  return out.join('\n');
};

/** The sheet as ASCII DXF (R12) in millimetres: lines on layers by style, texts and arrowheads. */
export function sheetDxf(layout: SheetLayout): string {
  const entities: string[] = [];
  for (const path of layout.paths) {
    const points = path.closed ? [...path.points, path.points[0] as readonly [number, number]] : path.points;
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1] as readonly [number, number], points[i] as readonly [number, number]];
      entities.push(pairs(0, 'LINE', 8, layers[path.style], 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0));
    }
  }
  for (const arrow of layout.arrows) {
    const [a, b, c] = arrowhead(arrow.tip, arrow.direction) as [[number, number], [number, number], [number, number]];
    entities.push(pairs(0, 'SOLID', 8, 'DIMENSIONS', 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0, 12, c[0], 22, c[1], 32, 0, 13, c[0], 23, c[1], 33, 0));
  }
  for (const text of layout.texts) {
    const align = { left: 0, center: 1, right: 2 }[text.align];
    // Aligned texts are placed by their second point.
    entities.push(pairs(0, 'TEXT', 8, 'TEXT', 10, text.at[0], 20, text.at[1], 30, 0, 40, text.size, 1, text.text, 72, align, 11, text.at[0], 21, text.at[1], 31, 0));
  }
  return [
    pairs(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC'),
    pairs(0, 'SECTION', 2, 'ENTITIES'),
    ...entities,
    pairs(0, 'ENDSEC', 0, 'EOF'),
    '',
  ].join('\n');
}
