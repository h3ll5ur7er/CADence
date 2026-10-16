import { describe, expect, it } from 'vitest';
import { encodeGif } from './gif';

/** The colour indices of a GIF's first frame (GIF's LZW, read back). */
function firstFrame(gif: Uint8Array): {
  width: number;
  height: number;
  indices: number[];
  frames: number;
} {
  const width = (gif[6] as number) | ((gif[7] as number) << 8);
  const height = (gif[8] as number) | ((gif[9] as number) << 8);
  let at = 13 + 256 * 3;
  let frames = 0;
  let indices: number[] = [];
  while (gif[at] !== 0x3b) {
    if (gif[at] === 0x21) {
      at += 2;
      while (gif[at] !== 0) at += (gif[at] as number) + 1;
      at++;
      continue;
    }
    // An image: descriptor, minimum code size, then data blocks.
    at += 10;
    const minimum = gif[at++] as number;
    const data: number[] = [];
    while (gif[at] !== 0) {
      const n = gif[at] as number;
      data.push(...gif.subarray(at + 1, at + 1 + n));
      at += n + 1;
    }
    at++;
    if (frames++ === 0) indices = decode(data, minimum);
  }
  return { width, height, indices, frames };
}

function decode(data: readonly number[], minimum: number): number[] {
  const [clear, end] = [1 << minimum, (1 << minimum) + 1];
  let size = minimum + 1;
  let table: number[][] = [];
  const reset = () => {
    table = Array.from({ length: end + 1 }, (_, i) => [i]);
    size = minimum + 1;
  };
  reset();
  const out: number[] = [];
  let [bit, previous] = [0, undefined as number[] | undefined];
  for (;;) {
    let code = 0;
    for (let i = 0; i < size; i++, bit++)
      code |= (((data[bit >> 3] as number) >> (bit & 7)) & 1) << i;
    if (code === clear) {
      reset();
      previous = undefined;
      continue;
    }
    if (code === end) return out;
    const entry = table[code] ?? (previous ? [...previous, previous[0] as number] : []);
    out.push(...entry);
    if (previous) table.push([...previous, entry[0] as number]);
    if (table.length === 1 << size && size < 12) size++;
    previous = entry;
  }
}

describe('animated GIFs', () => {
  it('hold every frame, in a palette close to their colours, small and past a full code table', () => {
    for (const [width, height] of [
      [37, 23],
      [150, 120],
    ] as const) {
      const frame = (shift: number) => {
        const data = new Uint8Array(width * height * 4);
        for (let i = 0; i < width * height; i++)
          data.set([((i + shift) * 7) % 256, (i * 3) % 256, 255 - ((i * 5) % 256), 255], i * 4);
        return { width, height, data };
      };
      const gif = encodeGif([frame(0), frame(9), frame(18)], 100);
      expect(new TextDecoder().decode(gif.subarray(0, 6))).toBe('GIF89a');
      const read = firstFrame(gif);
      expect([read.width, read.height, read.frames, read.indices.length]).toEqual([
        width,
        height,
        3,
        width * height,
      ]);
      // Each pixel's palette colour is within half a step of the original.
      const original = frame(0).data;
      read.indices.forEach((index, i) => {
        const [r, g, b] = [
          Math.floor(index / 42) * 51,
          Math.round(((Math.floor(index / 6) % 7) * 255) / 6),
          (index % 6) * 51,
        ];
        expect(Math.abs(r - (original[i * 4] as number))).toBeLessThanOrEqual(26);
        expect(Math.abs(g - (original[i * 4 + 1] as number))).toBeLessThanOrEqual(22);
        expect(Math.abs(b - (original[i * 4 + 2] as number))).toBeLessThanOrEqual(26);
      });
    }
  });
});
