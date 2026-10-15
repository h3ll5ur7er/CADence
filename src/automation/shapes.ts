import type { SketchConstraint, SketchEntity, Vec2 } from '@core/contracts';
import type { DesignCommand } from '@core/managers/design';

/**
 * Shorthands for scripts and agents: common outlines, fully constrained, as sketch geometry. Lengths
 * are numbers (millimetres) or expressions ("width", "2 * wall"). Ids start with the shape's `id`.
 */
export type ShapeCommand =
  /** A rectangle with its bottom left corner at (x, y): points `<id>:p1`…`p4` counter-clockwise, lines `<id>:bottom|right|top|left`. */
  | { readonly type: 'add-rectangle'; readonly sketchId: string; readonly id: string; readonly x: number; readonly y: number; readonly width: number | string; readonly height: number | string }
  /** A circle: centre `<id>:center`, circle `<id>`. */
  | { readonly type: 'add-circle'; readonly sketchId: string; readonly id: string; readonly x: number; readonly y: number; readonly diameter: number | string }
  /** A closed outline through the points, in order: points `<id>:p1`…, lines `<id>:l1`… (from p1 to p2, …, back to p1). */
  | { readonly type: 'add-polygon'; readonly sketchId: string; readonly id: string; readonly points: readonly Vec2[] };

/** What scripts and agents may run on a component: the design commands and the shorthands. */
export type ScriptCommand = DesignCommand | ShapeCommand;

const expression = (value: number | string) => String(value);
const fix = (id: string, point: string, [x, y]: Vec2): SketchConstraint => ({ id, kind: 'fix', point, x, y });

/** A shorthand as the design command it stands for; design commands pass through. */
export function expandShape(command: ScriptCommand): DesignCommand {
  switch (command.type) {
    case 'add-rectangle': {
      const { id, x, y } = command;
      const w = typeof command.width === 'number' ? command.width : 10;
      const h = typeof command.height === 'number' ? command.height : 10;
      const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const points = corners.map((_, i) => `${id}:p${i + 1}`) as [string, string, string, string];
      const sides = ['bottom', 'right', 'top', 'left'].map((side) => `${id}:${side}`) as [string, string, string, string];
      const entities: SketchEntity[] = [
        ...corners.map(([px, py], i): SketchEntity => ({ id: points[i] as string, kind: 'point', x: px, y: py })),
        ...sides.map((side, i): SketchEntity => ({ id: side, kind: 'line', start: points[i] as string, end: points[(i + 1) % 4] as string, construction: false })),
      ];
      const constraints: SketchConstraint[] = [
        fix(`${id}:fix`, points[0], [x, y]),
        { id: `${id}:h1`, kind: 'horizontal', line: sides[0] },
        { id: `${id}:h2`, kind: 'horizontal', line: sides[2] },
        { id: `${id}:v1`, kind: 'vertical', line: sides[1] },
        { id: `${id}:v2`, kind: 'vertical', line: sides[3] },
        { id: `${id}:width`, kind: 'horizontal-distance', points: [points[0], points[1]], expression: expression(command.width) },
        { id: `${id}:height`, kind: 'vertical-distance', points: [points[1], points[2]], expression: expression(command.height) },
      ];
      return { type: 'add-sketch-geometry', sketchId: command.sketchId, entities, constraints };
    }
    case 'add-circle': {
      const { id, x, y } = command;
      const center = `${id}:center`;
      const radius = typeof command.diameter === 'number' ? command.diameter / 2 : 5;
      return {
        type: 'add-sketch-geometry',
        sketchId: command.sketchId,
        entities: [
          { id: center, kind: 'point', x, y },
          { id, kind: 'circle', center, radius, construction: false },
        ],
        constraints: [fix(`${id}:fix`, center, [x, y]), { id: `${id}:diameter`, kind: 'diameter', curve: id, expression: expression(command.diameter) }],
      };
    }
    case 'add-polygon': {
      const { id, points } = command;
      const ids = points.map((_, i) => `${id}:p${i + 1}`);
      return {
        type: 'add-sketch-geometry',
        sketchId: command.sketchId,
        entities: [
          ...points.map(([x, y], i): SketchEntity => ({ id: ids[i] as string, kind: 'point', x, y })),
          ...ids.map((start, i): SketchEntity => ({ id: `${id}:l${i + 1}`, kind: 'line', start, end: ids[(i + 1) % ids.length] as string, construction: false })),
        ],
        constraints: points.map((at, i) => fix(`${id}:fix${i + 1}`, ids[i] as string, at)),
      };
    }
    default:
      return command;
  }
}
