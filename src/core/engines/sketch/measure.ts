import { type Dimension, isDimension, type Sketch, sketchOriginId } from '@core/contracts';
import { angleOf, normalizeAngle, type Vec2 } from '@core/utilities/math';

/**
 * What a dimension measures on the sketch as drawn (mm, radians), whatever its expression says:
 * the value a reference dimension shows (ADR-54). Lengths are unsigned; an angle is the one between
 * the lines' directions, from 0 to 180°. Undefined when what it measures is gone.
 */
export function measureDimension(sketch: Pick<Sketch, 'entities'>, dimension: Dimension): number | undefined {
  const entities = new Map(sketch.entities.map((e) => [e.id, e]));
  const at = (id: string): Vec2 | undefined => {
    if (id === sketchOriginId) return [0, 0];
    const p = entities.get(id);
    return p?.kind === 'point' ? [p.x, p.y] : undefined;
  };
  const both = (a: string, b: string): [Vec2, Vec2] | undefined => {
    const [p, q] = [at(a), at(b)];
    return p && q ? [p, q] : undefined;
  };
  const line = (id: string): [Vec2, Vec2] | undefined => {
    const l = entities.get(id);
    return l?.kind === 'line' ? both(l.start, l.end) : undefined;
  };
  switch (dimension.kind) {
    case 'distance':
    case 'horizontal-distance':
    case 'vertical-distance': {
      const ends = both(...dimension.points);
      if (!ends) return undefined;
      const [dx, dy] = [ends[1][0] - ends[0][0], ends[1][1] - ends[0][1]];
      return dimension.kind === 'distance' ? Math.hypot(dx, dy) : Math.abs(dimension.kind === 'horizontal-distance' ? dx : dy);
    }
    case 'point-line-distance': {
      const [p, l] = [at(dimension.point), line(dimension.line)];
      if (!p || !l) return undefined;
      const [s, e] = l;
      const length = Math.hypot(e[0] - s[0], e[1] - s[1]);
      return length > 0 ? Math.abs((e[0] - s[0]) * (p[1] - s[1]) - (e[1] - s[1]) * (p[0] - s[0])) / length : Math.hypot(p[0] - s[0], p[1] - s[1]);
    }
    case 'radius':
    case 'diameter': {
      const curve = entities.get(dimension.curve);
      const center = curve && 'center' in curve ? at(curve.center) : undefined;
      const start = curve?.kind === 'arc' ? at(curve.start) : undefined;
      const radius =
        curve?.kind === 'circle' ? curve.radius : curve?.kind === 'ellipse' ? curve.minorRadius : center && start ? Math.hypot(start[0] - center[0], start[1] - center[1]) : undefined;
      return radius === undefined ? undefined : dimension.kind === 'radius' ? radius : 2 * radius;
    }
    case 'angle': {
      const [a, b] = [line(dimension.lines[0]), line(dimension.lines[1])];
      if (!a || !b) return undefined;
      const turn = angleOf([b[1][0] - b[0][0], b[1][1] - b[0][1]]) - angleOf([a[1][0] - a[0][0], a[1][1] - a[0][1]]);
      return Math.abs(normalizeAngle(turn + Math.PI) - Math.PI);
    }
  }
}

/** The values the sketch's reference dimensions measure, by constraint id. */
export function referenceValues(sketch: Sketch): Map<string, number> {
  const values = new Map<string, number>();
  for (const c of sketch.constraints) {
    if (!isDimension(c) || !c.reference) continue;
    const value = measureDimension(sketch, c);
    if (value !== undefined) values.set(c.id, value);
  }
  return values;
}
