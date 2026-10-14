import { polar } from '@core/utilities/math';
import { boundsOf, type DrawingCurve, num } from './drawing';

/** SVG coordinates: Y flips because SVG's Y axis points down. */
const y = (value: number) => num(-value);

function element(curve: DrawingCurve): string {
  switch (curve.kind) {
    case 'line':
      return `<line x1="${num(curve.start[0])}" y1="${y(curve.start[1])}" x2="${num(curve.end[0])}" y2="${y(curve.end[1])}"/>`;
    case 'circle':
      return `<circle cx="${num(curve.center[0])}" cy="${y(curve.center[1])}" r="${num(curve.radius)}"/>`;
    case 'arc': {
      const start = polar(curve.center, curve.radius, curve.startAngle);
      const end = polar(curve.center, curve.radius, curve.startAngle + curve.sweep);
      const large = curve.sweep > Math.PI ? 1 : 0;
      // Counter-clockwise in sketch space turns clockwise on screen after the flip: sweep flag 0.
      return `<path d="M ${num(start[0])} ${y(start[1])} A ${num(curve.radius)} ${num(curve.radius)} 0 ${large} 0 ${num(end[0])} ${y(end[1])}"/>`;
    }
  }
}

/** SVG sized in millimetres, hairline strokes and no fill, as laser cutter software expects. */
export function writeSvg(curves: readonly DrawingCurve[]): string {
  const { min, max } = boundsOf(curves);
  const width = num(max[0] - min[0]);
  const height = num(max[1] - min[1]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${num(min[0])} ${y(max[1])} ${width} ${height}">`,
    '<g fill="none" stroke="#000" stroke-width="0.1">',
    ...curves.map(element),
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}
