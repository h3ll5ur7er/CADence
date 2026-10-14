import type { Vec2 } from '@core/contracts';

/** Numbers for messages: at most `decimals` decimals, no trailing zeros. */
export const format = (value: number, decimals = 3): string => String(Number(value.toFixed(decimals)));

export const describeSize = (size: readonly number[]): string => `${size.map(format).join(' × ')} mm`;

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Whether a footprint fits a bed as it is, turned by 90°, or not at all. */
export function fitsBed(size: Vec2, bed: Vec2): 'yes' | 'rotated' | 'no' {
  const slack = 1e-6;
  if (size[0] <= bed[0] + slack && size[1] <= bed[1] + slack) return 'yes';
  if (size[1] <= bed[0] + slack && size[0] <= bed[1] + slack) return 'rotated';
  return 'no';
}
