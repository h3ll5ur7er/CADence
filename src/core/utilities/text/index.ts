import type { Font } from 'opentype.js';
import type { Vec2 } from '../math';

/**
 * Text as outlines (docs/Architecture/Decisions.md#adr-26): glyphs of a bundled font laid out one
 * character at a time by their advance (and pair kerning where the font has a table opentype.js
 * reads), as closed contours of lines and cubic Béziers.
 */

export type TextWeight = 'regular' | 'bold';

/** A piece of a glyph's outline: a line, or a cubic Bézier through two control points. */
export type OutlineEdge =
  | { readonly kind: 'line'; readonly start: Vec2; readonly end: Vec2 }
  | { readonly kind: 'bezier'; readonly start: Vec2; readonly c1: Vec2; readonly c2: Vec2; readonly end: Vec2 };

/** One closed contour of a glyph (an outline or the hole of an "o"). */
export type Contour = readonly OutlineEdge[];

export interface TextPlacement {
  /** Where the text's baseline starts. */
  readonly at: Vec2;
  /** Height of the capital letters (mm). */
  readonly height: number;
  /** Direction of the baseline, radians counter-clockwise from the X axis. */
  readonly angle: number;
}

/** A parsed font with a cache of laid-out texts. */
export interface TextFont {
  outline(text: string, placement: TextPlacement): Contour[];
  /** How far the baseline of a text runs (mm), for aligning it. */
  advance(text: string, height: number): number;
  /** Capital height over font size: an SVG font size of 10 has capitals this many times as tall. */
  readonly capRatio: number;
}

/** Loads a font from its bytes (TTF, OTF or WOFF); opentype.js loads on first use. */
export async function loadFont(bytes: ArrayBuffer): Promise<TextFont> {
  const { parse } = await import('opentype.js');
  return fontOf(parse(bytes));
}

const close = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

export function fontOf(font: Font): TextFont {
  const capHeight = font.tables.os2?.sCapHeight || font.unitsPerEm * 0.7;
  return {
    capRatio: capHeight / font.unitsPerEm,
    advance(text, height) {
      const size = (height * font.unitsPerEm) / capHeight;
      const chars = [...text];
      return chars.reduce((sum, char, i) => {
        const glyph = font.charToGlyph(char);
        const next = chars[i + 1];
        const kerning = next === undefined ? 0 : font.getKerningValue(glyph, font.charToGlyph(next));
        return sum + (((glyph.advanceWidth ?? 0) + kerning) * size) / font.unitsPerEm;
      }, 0);
    },
    outline(text, { at, height, angle }) {
      // Font units → mm, with the capital height as the text height; Y flips (fonts draw downwards).
      const size = (height * font.unitsPerEm) / capHeight;
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      const place = (x: number, y: number): Vec2 => [at[0] + x * cos + y * sin, at[1] + x * sin - y * cos];
      const contours: Contour[] = [];
      let pen = 0;
      const chars = [...text];
      chars.forEach((char, i) => {
        const glyph = font.charToGlyph(char);
        contours.push(...glyphContours(glyph.getPath(pen, 0, size).commands, place));
        const next = chars[i + 1];
        const kerning = next === undefined ? 0 : font.getKerningValue(glyph, font.charToGlyph(next));
        pen += (((glyph.advanceWidth ?? 0) + kerning) * size) / font.unitsPerEm;
      });
      return contours;
    },
  };
}

type Command = import('opentype.js').PathCommand;

/** Path commands to closed contours; quadratic curves become exact cubic ones. */
function glyphContours(commands: readonly Command[], place: (x: number, y: number) => Vec2): Contour[] {
  const contours: Contour[] = [];
  let edges: OutlineEdge[] = [];
  let first: Vec2 | undefined;
  let pen: Vec2 | undefined;
  const finish = () => {
    if (first && pen && !close(pen, first)) edges.push({ kind: 'line', start: pen, end: first });
    if (edges.length) contours.push(edges);
    edges = [];
    first = undefined;
    pen = undefined;
  };
  for (const c of commands) {
    const p = c.x === undefined || c.y === undefined ? undefined : place(c.x, c.y);
    if (c.type === 'M') {
      finish();
      first = pen = p;
    } else if (c.type === 'L' && pen && p) {
      if (!close(pen, p)) edges.push({ kind: 'line', start: pen, end: p });
      pen = p;
    } else if (c.type === 'Q' && pen && p && c.x1 !== undefined && c.y1 !== undefined) {
      const q = place(c.x1, c.y1);
      const c1: Vec2 = [pen[0] + (2 / 3) * (q[0] - pen[0]), pen[1] + (2 / 3) * (q[1] - pen[1])];
      const c2: Vec2 = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])];
      if (!close(pen, p)) edges.push({ kind: 'bezier', start: pen, c1, c2, end: p });
      pen = p;
    } else if (c.type === 'C' && pen && p && c.x1 !== undefined && c.y1 !== undefined && c.x2 !== undefined && c.y2 !== undefined) {
      if (!close(pen, p)) edges.push({ kind: 'bezier', start: pen, c1: place(c.x1, c.y1), c2: place(c.x2, c.y2), end: p });
      pen = p;
    } else if (c.type === 'Z') {
      finish();
    }
  }
  finish();
  return contours;
}

/** The bundled font files (Inter, OFL 1.1), as the build copies them to `fonts/`. */
export const fontFiles: Readonly<Record<TextWeight, string>> = {
  regular: 'inter-latin-400-normal.woff',
  bold: 'inter-latin-700-normal.woff',
};

/**
 * Loads the bundled fonts once each: from the given URLs in browsers and workers, or from the font
 * package in Node (tests, the command line).
 */
export function fontSource(urls?: Readonly<Record<TextWeight, string>>): (weight: TextWeight) => Promise<TextFont> {
  const loaded = new Map<TextWeight, Promise<TextFont>>();
  return (weight) => {
    let font = loaded.get(weight);
    if (!font) {
      font = (urls ? fetch(urls[weight]).then((r) => r.arrayBuffer()) : readPackageFont(fontFiles[weight])).then(loadFont);
      loaded.set(weight, font);
    }
    return font;
  };
}

async function readPackageFont(file: string): Promise<ArrayBuffer> {
  // A variable module name keeps bundlers from pulling Node's file system into browser builds.
  const fs = 'node:fs/promises';
  const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile(path: string): Promise<Uint8Array> };
  const bytes = await readFile(`node_modules/@fontsource/inter/files/${file}`);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
