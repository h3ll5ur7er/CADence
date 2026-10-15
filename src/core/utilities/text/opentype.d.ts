/** The small part of opentype.js (MIT) that CADence uses; the package ships no type declarations. */
declare module 'opentype.js' {
  export interface PathCommand {
    readonly type: 'M' | 'L' | 'Q' | 'C' | 'Z';
    readonly x?: number;
    readonly y?: number;
    readonly x1?: number;
    readonly y1?: number;
    readonly x2?: number;
    readonly y2?: number;
  }
  export interface Path {
    readonly commands: readonly PathCommand[];
  }
  export interface Glyph {
    readonly advanceWidth?: number;
    getPath(x: number, y: number, fontSize: number): Path;
  }
  export interface Font {
    readonly unitsPerEm: number;
    readonly tables: { readonly os2?: { readonly sCapHeight?: number } };
    charToGlyph(char: string): Glyph;
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}

/** The package's ES module build, which the app loads (see `loadFont`). */
declare module 'opentype.js/dist/opentype.mjs' {
  export { parse } from 'opentype.js';
}
