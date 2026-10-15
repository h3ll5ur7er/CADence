import { type LengthUnit, lengthUnitSize } from '@core/contracts';

/** Display formats for measured values: no float noise, unit attached. */

const trimmed = (value: number, decimals: number): string => {
  const rounded = Number(value.toFixed(decimals));
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', { maximumFractionDigits: decimals });
};

/** A length (in mm) shown in a unit; `power` 2 or 3 for areas and volumes. */
export const lengthIn = (unit: LengthUnit, value: number, power: 1 | 2 | 3 = 1): string =>
  `${trimmed(value / lengthUnitSize[unit] ** power, power === 1 ? 3 : 2)} ${unit}${['', '²', '³'][power - 1]}`;

/** Lengths in mm; `power` 2 or 3 for areas and volumes. */
export const millimetres = (value: number, power: 1 | 2 | 3 = 1): string => lengthIn('mm', value, power);

/** A point (in mm) in a unit, without the unit. */
export const pointIn = (unit: LengthUnit, p: readonly number[]): string => p.map((v) => trimmed(v / lengthUnitSize[unit], 2)).join(', ');

export const degrees = (radians: number): string => `${trimmed((radians * 180) / Math.PI, 2)}°`;

export const grams = (value: number): string => (value >= 1000 ? `${trimmed(value / 1000, 3)} kg` : `${trimmed(value, 2)} g`);

export const point = (p: readonly number[]): string => p.map((v) => trimmed(v, 2)).join(', ');
