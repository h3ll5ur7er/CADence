/**
 * ISO 286-1 limits and fits (CAD-165): the deviations of a tolerance class such as `H7` (a hole,
 * capital letters) or `g6` (a shaft) for a nominal size up to 500 mm, from the standard's tables of
 * standard tolerance grades (IT5 to IT12) and fundamental deviations (D to P, d to p, JS and js).
 */

/** The upper ends of the standard's size ranges (mm); a size belongs to the first range it is not above. */
const ranges = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500] as const;

/** Standard tolerance grades, µm, by size range. */
const grades: Readonly<Record<number, readonly number[]>> = {
  5: [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6: [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7: [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8: [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9: [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
  12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460, 520, 570, 630],
};

/** Shafts' upper deviations (es) for d to h, µm. */
const upper: Readonly<Record<string, readonly number[]>> = {
  d: [-20, -30, -40, -50, -65, -80, -100, -120, -145, -170, -190, -210, -230],
  e: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135],
  f: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68],
  g: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20],
  h: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

/** Shafts' lower deviations (ei) for k (grades 4 to 7) to p, µm. */
const lower: Readonly<Record<string, readonly number[]>> = {
  k: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5],
  m: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23],
  n: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40],
  p: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68],
};

/** A tolerance class's deviations from the nominal size, in millimetres (upper above lower). */
export interface Deviations {
  readonly upper: number;
  readonly lower: number;
}

/** The deviations of a tolerance class (`H7`, `g6`, `js5` …) at a nominal size, or why there are none. */
export function fitDeviations(fit: string, size: number): Deviations | { readonly error: string } {
  const match = /^(JS|js|[A-Za-z])(\d{1,2})$/.exec(fit.trim());
  if (!match) return { error: `${fit} is not a tolerance class such as H7 or g6.` };
  const [, letters, digits] = match as unknown as [string, string, string];
  const grade = Number(digits);
  const range = ranges.findIndex((end) => size <= end);
  if (!(size > 0) || range < 0) return { error: 'ISO 286 fits go from 0 to 500 mm.' };
  const it = grades[grade]?.[range];
  if (it === undefined) return { error: `Grades IT5 to IT12 are known; ${fit} is IT${grade}.` };
  // + 0: no minus zero.
  const micro = (u: number, l: number): Deviations => ({ upper: u / 1000 + 0, lower: l / 1000 + 0 });
  if (letters === 'js' || letters === 'JS') return micro(it / 2, -it / 2);
  const hole = letters === letters.toUpperCase();
  const letter = letters.toLowerCase();
  if (!hole) {
    const es = upper[letter]?.[range];
    if (es !== undefined) return micro(es, es - it);
    const ei = lower[letter]?.[range];
    if (ei === undefined) return { error: `Shafts d to p and js are known; not ${fit}.` };
    // k has no lower deviation above grade 7.
    const from = letter === 'k' && (grade < 4 || grade > 7) ? 0 : ei;
    return micro(from + it, from);
  }
  // Holes mirror shafts: D to H have the lower deviation shafts d to h have as their upper one.
  const es = upper[letter]?.[range];
  if (es !== undefined) return micro(-es + it, -es);
  const ei = lower[letter]?.[range];
  if (ei === undefined) return { error: `Holes D to P and JS are known; not ${fit}.` };
  // K, M and N up to grade 8 and P up to grade 7 add Δ, the step from the grade below (none up to 3 mm).
  const below = grades[grade - 1]?.[range];
  const delta = range > 0 && below !== undefined ? it - below : 0;
  const special = letter === 'p' ? grade <= 7 : grade <= 8;
  const top = special ? -ei + delta : letter === 'm' || letter === 'p' ? -ei : 0;
  return micro(top, top - it);
}

/** A fit's text and deviations: a class (`H7`) or a pair (`H7/g6`, the hole's then the shaft's). */
export function fitOf(fit: string, size: number): { readonly text: string; readonly deviations: readonly Deviations[] } | { readonly error: string } {
  const parts = fit.split('/').map((p) => p.trim());
  if (parts.length > 2 || parts.some((p) => !p)) return { error: `${fit} is not a tolerance class such as H7, or a fit such as H7/g6.` };
  const deviations: Deviations[] = [];
  for (const part of parts) {
    const found = fitDeviations(part, size);
    if ('error' in found) return found;
    deviations.push(found);
  }
  return { text: parts.join('/'), deviations };
}
