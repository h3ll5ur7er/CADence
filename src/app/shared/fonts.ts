import { InjectionToken } from '@angular/core';

/** A font file to import into a project. */
export interface FontFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * A Google Font as a WOFF file (Latin letters), from Fontsource's copies on jsDelivr: the family as
 * Google Fonts names it (e.g. "Roboto Slab"), regular or bold.
 */
export async function googleFont(family: string, bold: boolean): Promise<FontFile> {
  const id = family.trim().toLowerCase().replace(/\s+/g, '-');
  const weight = bold ? 700 : 400;
  const response = await fetch(`https://cdn.jsdelivr.net/fontsource/fonts/${encodeURIComponent(id)}@latest/latin-${weight}-normal.woff`);
  if (!response.ok) throw new Error(`Google Fonts has no font "${family.trim()}"${bold ? ' in bold' : ''} (or it could not be reached).`);
  return { name: `${family.trim()}${bold ? ' Bold' : ''}.woff`, bytes: new Uint8Array(await response.arrayBuffer()) };
}

/** The fonts installed on this computer (desktop only): their names, and reading one. */
export interface SystemFonts {
  list(): Promise<readonly string[]>;
  read(name: string): Promise<FontFile>;
}

export const SYSTEM_FONTS = new InjectionToken<SystemFonts | undefined>('System fonts', { factory: () => undefined });
