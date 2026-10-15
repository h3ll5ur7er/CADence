import { type DrawingCurve, num } from './drawing';

const degrees = (radians: number) => (radians * 180) / Math.PI;

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
  }
}

/** ASCII DXF (R12 entities) in millimetres ($INSUNITS 4); arcs are counter-clockwise as DXF expects. */
export function writeDxf(curves: readonly DrawingCurve[]): string {
  return [
    pairs(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC'),
    pairs(0, 'SECTION', 2, 'ENTITIES'),
    ...curves.map(entity),
    pairs(0, 'ENDSEC', 0, 'EOF'),
    '',
  ].join('\n');
}
