/** Meshes for tests of the Interchange Engine and of what uses it. */

export { writeStl } from '../solids';

/**
 * A scanned-looking ball: a UV sphere of radius `r` with a little noise on the radius, closed at the
 * poles: (`rings` − 1) × `segments` × 2 triangles.
 */
export function scan(rings: number, segments: number, r = 20) {
  const positions: number[] = [0, 0, -r];
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.02 * r;
  };
  for (let i = 1; i < rings; i++) {
    const theta = Math.PI * (i / rings) - Math.PI / 2;
    for (let j = 0; j < segments; j++) {
      const phi = (2 * Math.PI * j) / segments;
      const radius = r + noise();
      positions.push(radius * Math.cos(theta) * Math.cos(phi), radius * Math.cos(theta) * Math.sin(phi), radius * Math.sin(theta));
    }
  }
  positions.push(0, 0, r);
  const top = positions.length / 3 - 1;
  const at = (i: number, j: number) => 1 + (i - 1) * segments + (j % segments);
  const indices: number[] = [];
  for (let j = 0; j < segments; j++) indices.push(0, at(1, j + 1), at(1, j));
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) indices.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  }
  for (let j = 0; j < segments; j++) indices.push(top, at(rings - 1, j), at(rings - 1, j + 1));
  return { name: 'Scan', positions, indices };
}
