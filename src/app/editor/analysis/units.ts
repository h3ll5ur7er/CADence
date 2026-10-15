/** Display formats for measured values: no float noise, unit attached. */

const trimmed = (value: number, decimals: number): string => {
  const rounded = Number(value.toFixed(decimals));
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', { maximumFractionDigits: decimals });
};

/** Lengths in mm; `power` 2 or 3 for areas and volumes. */
export const millimetres = (value: number, power: 1 | 2 | 3 = 1): string =>
  `${trimmed(value, power === 1 ? 3 : 2)} ${['mm', 'mm²', 'mm³'][power - 1]}`;

export const degrees = (radians: number): string => `${trimmed((radians * 180) / Math.PI, 2)}°`;

export const grams = (value: number): string => (value >= 1000 ? `${trimmed(value / 1000, 3)} kg` : `${trimmed(value, 2)} g`);

export const point = (p: readonly number[]): string => p.map((v) => trimmed(v, 2)).join(', ');
