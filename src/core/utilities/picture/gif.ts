import type { Pixels } from './index';

/**
 * Pixels as an animated GIF, looping: for a motion study's animation where no video encoder is at
 * hand (the command line, agents). Colours are rounded to a fixed palette of 6 × 7 × 6 levels;
 * transparent pixels are white. All frames have the size of the first.
 */
export function encodeGif(frames: readonly Pixels[], delayMs: number): Uint8Array {
  const first = frames[0];
  if (!first) throw new Error('An animation needs at least one frame.');
  const { width, height } = first;
  const out: number[] = [];
  const word = (value: number) => out.push(value & 0xff, (value >> 8) & 0xff);
  const text = (value: string) => out.push(...[...value].map((c) => c.charCodeAt(0)));
  text('GIF89a');
  word(width);
  word(height);
  out.push(0xf7, 0, 0); // a global table of 256 colours
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = i < 252 ? [Math.floor(i / 42) * 51, Math.round(((Math.floor(i / 6) % 7) * 255) / 6), (i % 6) * 51] : [255, 255, 255];
    out.push(r, g, b);
  }
  out.push(0x21, 0xff, 0x0b);
  text('NETSCAPE2.0');
  out.push(3, 1, 0, 0, 0); // loop for ever
  const delay = Math.max(2, Math.round(delayMs / 10));
  for (const frame of frames) {
    out.push(0x21, 0xf9, 4, 0x04);
    word(delay);
    out.push(0, 0);
    out.push(0x2c);
    word(0);
    word(0);
    word(width);
    word(height);
    out.push(0);
    const indices = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const at = i * 4;
      const alpha = (frame.data[at + 3] ?? 255) / 255;
      const [r, g, b] = [0, 1, 2].map((c) => (frame.data[at + c] ?? 0) * alpha + 255 * (1 - alpha)) as [number, number, number];
      indices[i] = Math.round(r / 51) * 42 + Math.round((g / 255) * 6) * 6 + Math.round(b / 51);
    }
    out.push(8);
    const data = lzw(indices);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.subarray(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}

/** GIF's LZW compression of 8-bit colour indices. */
function lzw(indices: Uint8Array): Uint8Array {
  const [clear, end] = [256, 257];
  const bytes: number[] = [];
  let [buffer, bits] = [0, 0];
  let size = 9;
  const emit = (code: number) => {
    buffer |= code << bits;
    bits += size;
    while (bits >= 8) {
      bytes.push(buffer & 0xff);
      buffer >>= 8;
      bits -= 8;
    }
  };
  let table = new Map<number, number>();
  let next = 258;
  emit(clear);
  let prefix = indices[0] as number;
  for (let i = 1; i < indices.length; i++) {
    const value = indices[i] as number;
    const key = prefix * 256 + value;
    const known = table.get(key);
    if (known !== undefined) {
      prefix = known;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      table.set(key, next++);
      if (next > 1 << size && size < 12) size++;
    } else {
      emit(clear);
      table = new Map();
      next = 258;
      size = 9;
    }
    prefix = value;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) bytes.push(buffer & 0xff);
  return new Uint8Array(bytes);
}
