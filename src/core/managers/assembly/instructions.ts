import type { ExplodedView } from '@core/contracts';
import { pageSizes, type PdfOp, type PdfPage, pdfDocument } from '@core/utilities/pdf';
import type { BomLine, InstructionPicture } from './assembly-manager';

export interface Instructions {
  readonly title: string;
  readonly view: ExplodedView;
  readonly bom: readonly BomLine[];
  /** Instance (and copy) names by id. */
  readonly names: ReadonlyMap<string, string>;
  /** The assembled state, then after each step of the view. */
  readonly pictures: readonly InstructionPicture[];
}

const { width, height } = pageSizes.a4;
const margin = 40;
const grams = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kg` : `${v.toFixed(1)} g`);

/** A picture as large as fits the box, centred in it. */
function picture(image: number, source: InstructionPicture, box: { x: number; y: number; width: number; height: number }): PdfOp {
  const scale = Math.min(box.width / source.width, box.height / source.height);
  const [w, h] = [source.width * scale, source.height * scale];
  return { kind: 'image', image, x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h };
}

/** A parts table from `top` down; returns the ops and where it ends. */
function partsTable(lines: readonly BomLine[], top: number, counts?: ReadonlyMap<BomLine, number>): { ops: PdfOp[]; bottom: number } {
  const columns = [margin, margin + 250, margin + 330, margin + 430];
  const ops: PdfOp[] = [];
  let y = top;
  const row = (cells: readonly string[], bold = false) => {
    // Counts line up on the right.
    cells.forEach((text, i) => ops.push({ kind: 'text', x: (columns[i] as number) + (i === 1 ? 30 : 0), y, size: 10, text, bold, ...(i === 1 ? { align: 'right' as const } : {}) }));
    y -= 16;
  };
  row(['Part', 'Count', 'Material', 'Mass each'], true);
  ops.push({ kind: 'line', points: [[margin, y + 11], [width - margin, y + 11]], width: 0.5, gray: 0.6 });
  for (const line of lines) row([line.configuration ? `${line.component} (${line.configuration})` : line.component, String(counts?.get(line) ?? line.count), line.material, grams(line.mass)]);
  return { ops, bottom: y };
}

/** Build instructions: the parts, one page per step (an exploded view's steps in reverse), and the finished assembly. */
export function instructionsPdf({ title, view, bom, names, pictures }: Instructions): Uint8Array {
  const steps = view.steps.length;
  const pages: PdfPage[] = [];
  // The parts and everything taken apart.
  const table = partsTable(bom, height - margin - 60);
  pages.push({
    width,
    height,
    ops: [
      { kind: 'text', x: margin, y: height - margin - 10, size: 22, text: title, bold: true },
      { kind: 'text', x: margin, y: height - margin - 34, size: 12, text: `Build instructions · ${steps} step${steps === 1 ? '' : 's'}` },
      ...table.ops,
      picture(steps, pictures[steps] as InstructionPicture, { x: margin, y: margin, width: width - 2 * margin, height: table.bottom - margin - 20 }),
    ],
  });
  // Fitting the parts of the last step first.
  for (let i = 1; i <= steps; i++) {
    const index = steps - i;
    const step = view.steps[index];
    if (!step) continue;
    const fitted = step.instances.map((id) => names.get(id) ?? id);
    const lines = bom.filter((l) => l.instances.some((id) => step.instances.includes(id)));
    const counts = new Map(lines.map((l) => [l, l.instances.filter((id) => step.instances.includes(id)).length]));
    const parts = partsTable(lines, height - margin - 80, counts);
    pages.push({
      width,
      height,
      ops: [
        { kind: 'text', x: margin, y: height - margin - 10, size: 18, text: `Step ${i} of ${steps}`, bold: true },
        { kind: 'text', x: margin, y: height - margin - 34, size: 11, text: `Fit ${fitted.join(', ')}.` },
        ...parts.ops,
        picture(index + 1, pictures[index + 1] as InstructionPicture, { x: margin, y: margin, width: width - 2 * margin, height: parts.bottom - margin - 20 }),
      ],
    });
  }
  pages.push({
    width,
    height,
    ops: [
      { kind: 'text', x: margin, y: height - margin - 10, size: 18, text: 'Finished', bold: true },
      picture(0, pictures[0] as InstructionPicture, { x: margin, y: margin, width: width - 2 * margin, height: height - 2 * margin - 40 }),
    ],
  });
  return pdfDocument(pages, pictures, title);
}
