import type { ComponentDocument, HoleFeature, Parameter, ThreadFeature } from '@core/contracts';
import type { ParameterEngine } from '@core/engines/parameter';
import { formatValue } from './layout';

/** The feature that made a named hole face or edge: `f:<feature>:wall:…`, `bore`, `sink`, `floor`, `point`. */
const holeFeatureOf = (name: string) => /(?:^|[|&:])f:([^:|&~@]+):(?:wall|bore|sink|floor|tip|point)/.exec(name)?.[1];

/**
 * What a hole callout says about the circle `name` (radius `radius` mm): from its hole feature
 * (count, diameter, depth, counterbore or countersink, thread), else its diameter.
 */
export function holeCallout(document: ComponentDocument | undefined, projectParameters: readonly Parameter[], name: string, radius: number, parameters: ParameterEngine): string[] {
  const id = holeFeatureOf(name);
  const hole = document?.timeline.find((i): i is HoleFeature => i.id === id && i.type === 'hole');
  if (!document || !hole) return [`⌀${formatValue(2 * radius)}`];
  const own = new Set(document.parameters.map((p) => p.name));
  const evaluated = parameters.evaluateAll([...projectParameters.filter((p) => !own.has(p.name)), ...document.parameters]);
  const scope = evaluated.ok ? evaluated.value : new Map();
  const value = (expression: string, kind: 'length' | 'angle' = 'length') => {
    const result = parameters.evaluate(expression, kind, scope);
    return result.ok ? formatValue(kind === 'angle' ? (result.value * 180) / Math.PI : result.value) : expression;
  };
  const count = hole.points.length > 1 ? `${hole.points.length} × ` : '';
  const thread = document.timeline.find((i): i is ThreadFeature => i.type === 'thread' && holeFeatureOf(i.face.name) === hole.id);
  const point = hole.extent === 'blind' && hole.drillPoint ? `, ${value(hole.pointAngle?.trim() || '118 deg', 'angle')}° point` : '';
  const lines = [`${count}⌀${value(hole.diameter)} ${hole.extent === 'through' ? 'thru' : `depth ${value(hole.depth)}${point}`}`];
  if (hole.kind === 'counterbore') lines.push(`counterbore ⌀${value(hole.boreDiameter)} depth ${value(hole.boreDepth)}`);
  if (hole.kind === 'countersink') lines.push(`countersink ⌀${value(hole.sinkDiameter)} × ${value(hole.sinkAngle, 'angle')}°`);
  if (thread) lines.unshift(`${count}${thread.size} thread${thread.length ? ` depth ${value(thread.length)}` : ''}`);
  return lines;
}
