/** Small exchange files for tests. */

/** An ASCII STL of a closed, outward cube `size` mm wide with its corner at the origin. */
export function cubeStl(size = 10): Uint8Array {
  const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1].map((v) => v * size);
  const triangles = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const facets: string[] = [];
  for (let t = 0; t < triangles.length; t += 3) {
    const vertices = [0, 1, 2].map((k) => {
      const i = (triangles[t + k] as number) * 3;
      return `vertex ${p[i]} ${p[i + 1]} ${p[i + 2]}`;
    });
    facets.push(['facet normal 0 0 0', 'outer loop', ...vertices, 'endloop', 'endfacet'].join('\n'));
  }
  return new TextEncoder().encode(['solid cube', ...facets, 'endsolid cube'].join('\n'));
}

/** A 40 × 20 mm SVG plate with a ⌀8 hole. */
export const plateSvg = (): Uint8Array =>
  new TextEncoder().encode('<svg viewBox="0 0 40 20" width="40mm" height="20mm"><rect width="40" height="20"/><circle cx="30" cy="10" r="4"/></svg>');
