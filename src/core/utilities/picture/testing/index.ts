import { encodePng } from '../index';

/** A PNG (RGBA, 8 bit) of the pixels `dark(x, y)` black, the others white. */
export function png(width: number, height: number, dark: (x: number, y: number) => boolean): Promise<Uint8Array> {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(dark(x, y) ? [0, 0, 0, 255] : [255, 255, 255, 255], (y * width + x) * 4);
  return encodePng({ width, height, data });
}
