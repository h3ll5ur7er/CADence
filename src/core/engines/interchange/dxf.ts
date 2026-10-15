import { type DrawingCurve, num, samplePoints } from './drawing';

/** Degrees in [0, 360), as DXF readers expect for arc angles. */
const degrees = (radians: number) => ((((radians * 180) / Math.PI) % 360) + 360) % 360;

/** DXF group code/value pairs, one per line, as every CAD and laser program reads them. */
function pairs(...items: (string | number)[]): string {
  const lines: string[] = [];
  for (let i = 0; i < items.length; i += 2) lines.push(String(items[i]), typeof items[i + 1] === 'number' ? num(items[i + 1] as number) : String(items[i + 1]));
  return lines.join('\n');
}

function entity(curve: DrawingCurve): string {
  switch (curve.kind) {
    case 'line':
      return pairs(0, 'LINE', 8, '0', 10, curve.start[0], 20, curve.start[1], 30, 0, 11, curve.end[0], 21, curve.end[1], 31, 0);
    case 'circle':
      return pairs(0, 'CIRCLE', 8, '0', 10, curve.center[0], 20, curve.center[1], 30, 0, 40, curve.radius);
    case 'arc':
      return pairs(
        0, 'ARC', 8, '0',
        10, curve.center[0], 20, curve.center[1], 30, 0, 40, curve.radius,
        50, degrees(curve.startAngle), 51, degrees(curve.startAngle + curve.sweep),
      );
    case 'bezier':
    case 'ellipse': {
      // R12 has no splines or ellipses: a polyline that stays within 0.005 mm of the curve, which every laser program reads.
      const points = samplePoints(curve);
      const closed = curve.kind === 'ellipse' && curve.sweep >= 2 * Math.PI - 1e-9;
      const vertices = (closed ? points.slice(0, -1) : points).map((p) => pairs(0, 'VERTEX', 8, '0', 10, p[0], 20, p[1], 30, 0));
      return [pairs(0, 'POLYLINE', 8, '0', 66, 1, 70, closed ? 1 : 0, 10, 0, 20, 0, 30, 0), ...vertices, pairs(0, 'SEQEND', 8, '0')].join('\n');
    }
  }
}

/** ASCII DXF (R12 entities) in millimetres ($INSUNITS 4); arcs are counter-clockwise as DXF expects. */
/** `marks` (bend lines) go on the layer BEND, so cutting software can score them or leave them out. */
export function writeDxf(curves: readonly DrawingCurve[], marks: readonly DrawingCurve[] = []): string {
  return [
    pairs(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC'),
    pairs(0, 'SECTION', 2, 'ENTITIES'),
    ...curves.map(entity),
    ...marks.map((m) => entity(m).replace('\n8\n0\n', '\n8\nBEND\n')),
    pairs(0, 'ENDSEC', 0, 'EOF'),
    '',
  ].join('\n');
}
