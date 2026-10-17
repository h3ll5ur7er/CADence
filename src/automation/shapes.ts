import { type SketchConstraint, type SketchEntity, sketchOriginId, type Vec2 } from '@core/contracts';
import type { DesignCommand } from '@core/managers/design';

/** A length: a number (millimetres) or an expression ("width", "2 * wall", "rod - 5"). */
type Length = number | string;

/**
 * Shorthands for scripts and agents: common outlines, fully constrained, as sketch geometry. Lengths
 * and positions are numbers (millimetres) or expressions ("width", "2 * wall"); a position given by
 * an expression is dimensioned from the sketch origin, so it follows the parameters (CAD-108). Ids
 * start with the shape's `id`.
 */
export type ShapeCommand =
  /** A rectangle with its bottom left corner at (x, y): points `<id>:p1`…`p4` counter-clockwise, lines `<id>:bottom|right|top|left`. */
  | { readonly type: 'add-rectangle'; readonly sketchId: string; readonly id: string; readonly x: Length; readonly y: Length; readonly width: Length; readonly height: Length }
  /** A circle: centre `<id>:center`, circle `<id>`. */
  | { readonly type: 'add-circle'; readonly sketchId: string; readonly id: string; readonly x: Length; readonly y: Length; readonly diameter: Length }
  /** A closed outline through the points, in order: points `<id>:p1`…, lines `<id>:l1`… (from p1 to p2, …, back to p1). */
  | { readonly type: 'add-polygon'; readonly sketchId: string; readonly id: string; readonly points: readonly (readonly [Length, Length])[] };

/**
 * What the app does through its dialogs rather than design commands, as commands for scripts and
 * agents (CAD-124).
 */
export type SessionCommand =
  /** An imported DXF, SVG or picture (a document of the project) into a sketch, as curves with ids starting `idPrefix`. */
  | { readonly type: 'insert-drawing'; readonly sketchId: string; readonly document: string; readonly idPrefix: string; readonly onePiece?: boolean; readonly relations?: 'none' | 'infer' | 'fix' }
  /** The configuration table from CSV (a column per parameter, a row per configuration, as `export_component` writes it). */
  | { readonly type: 'import-configurations'; readonly csv: string }
  /** Relations the sketcher would suggest for a sketch (horizontal, vertical, coincident …), added with ids starting `idPrefix`. */
  | { readonly type: 'add-suggested-constraints'; readonly sketchId: string; readonly idPrefix: string };

/** What scripts and agents may run on a component: the design commands, the shorthands and the session commands. */
export type ScriptCommand = DesignCommand | ShapeCommand | SessionCommand;

/** A rough value of an expression (mm), to start the solver near the answer; the dimension sets it exactly. */
export type Guess = (expression: string) => number;

const expression = (value: Length) => (typeof value === 'number' ? `${value} mm` : value);

/** A point held where it is: fixed when both coordinates are numbers, else dimensioned from the origin. */
function hold(id: string, point: string, [x, y]: readonly [Length, Length]): SketchConstraint[] {
  if (typeof x === 'number' && typeof y === 'number') return [{ id, kind: 'fix', point, x, y }];
  return [
    { id: `${id}:x`, kind: 'horizontal-distance', points: [sketchOriginId, point], expression: expression(x) },
    { id: `${id}:y`, kind: 'vertical-distance', points: [sketchOriginId, point], expression: expression(y) },
  ];
}

/** A shorthand as the design command it stands for; design commands pass through. */
export function expandShape(command: DesignCommand | ShapeCommand, guess: Guess = roughValue()): DesignCommand {
  const at = (value: Length) => (typeof value === 'number' ? value : guess(value));
  switch (command.type) {
    case 'add-rectangle': {
      const { id } = command;
      const [x, y, w, h] = [at(command.x), at(command.y), at(command.width), at(command.height)];
      const corners: Vec2[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
      const points = corners.map((_, i) => `${id}:p${i + 1}`) as [string, string, string, string];
      const sides = ['bottom', 'right', 'top', 'left'].map((side) => `${id}:${side}`) as [string, string, string, string];
      const entities: SketchEntity[] = [
        ...corners.map(([px, py], i): SketchEntity => ({ id: points[i] as string, kind: 'point', x: px, y: py })),
        ...sides.map((side, i): SketchEntity => ({ id: side, kind: 'line', start: points[i] as string, end: points[(i + 1) % 4] as string, construction: false })),
      ];
      const constraints: SketchConstraint[] = [
        ...hold(`${id}:fix`, points[0], [command.x, command.y]),
        { id: `${id}:h1`, kind: 'horizontal', line: sides[0] },
        { id: `${id}:h2`, kind: 'horizontal', line: sides[2] },
        { id: `${id}:v1`, kind: 'vertical', line: sides[1] },
        { id: `${id}:v2`, kind: 'vertical', line: sides[3] },
        { id: `${id}:width`, kind: 'horizontal-distance', points: [points[0], points[1]], expression: String(command.width) },
        { id: `${id}:height`, kind: 'vertical-distance', points: [points[1], points[2]], expression: String(command.height) },
      ];
      return { type: 'add-sketch-geometry', sketchId: command.sketchId, entities, constraints };
    }
    case 'add-circle': {
      const { id } = command;
      const center = `${id}:center`;
      return {
        type: 'add-sketch-geometry',
        sketchId: command.sketchId,
        entities: [
          { id: center, kind: 'point', x: at(command.x), y: at(command.y) },
          { id, kind: 'circle', center, radius: Math.abs(at(command.diameter)) / 2 || 5, construction: false },
        ],
        constraints: [...hold(`${id}:fix`, center, [command.x, command.y]), { id: `${id}:diameter`, kind: 'diameter', curve: id, expression: String(command.diameter) }],
      };
    }
    case 'add-polygon': {
      const { id, points } = command;
      const ids = points.map((_, i) => `${id}:p${i + 1}`);
      return {
        type: 'add-sketch-geometry',
        sketchId: command.sketchId,
        entities: [
          ...points.map(([x, y], i): SketchEntity => ({ id: ids[i] as string, kind: 'point', x: at(x), y: at(y) })),
          ...ids.map((start, i): SketchEntity => ({ id: `${id}:l${i + 1}`, kind: 'line', start, end: ids[(i + 1) % ids.length] as string, construction: false })),
        ],
        constraints: points.flatMap((point, i) => hold(`${id}:fix${i + 1}`, ids[i] as string, point)),
      };
    }
    default:
      return command;
  }
}

/**
 * A rough evaluator: numbers (mm, cm, m, in), the given values by name, + − × ÷ and parentheses.
 * Anything else counts as 10 mm, enough for the solver to start from.
 */
export function roughValue(values: ReadonlyMap<string, number> = new Map()): Guess {
  const units: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
  return (source) => {
    const tokens = source.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][\w.]*|[-+*/()]/g) ?? [];
    let at = 0;
    const peek = () => tokens[at];
    const sum = (): number => {
      let value = product();
      while (peek() === '+' || peek() === '-') value = tokens[at++] === '+' ? value + product() : value - product();
      return value;
    };
    const product = (): number => {
      let value = unary();
      while (peek() === '*' || peek() === '/') value = tokens[at++] === '*' ? value * unary() : value / unary();
      return value;
    };
    const unary = (): number => (peek() === '-' ? (at++, -unary()) : peek() === '+' ? (at++, unary()) : atom());
    const atom = (): number => {
      const token = tokens[at++];
      if (token === '(') {
        const value = sum();
        at++;
        return value;
      }
      if (token !== undefined && /^\d/.test(token)) {
        const unit = peek();
        if (unit !== undefined && units[unit] !== undefined) return Number(token) * (units[tokens[at++] as string] as number);
        return Number(token);
      }
      return token !== undefined && values.has(token) ? (values.get(token) as number) : NaN;
    };
    const value = sum();
    return Number.isFinite(value) && at === tokens.length ? value : source.trim().startsWith('-') ? -10 : 10;
  };
}
