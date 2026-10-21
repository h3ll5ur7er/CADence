import type { ComponentDocument, HoleFeature, Parameter, ThreadFeature } from '@core/contracts';
import type { ParameterEngine } from '@core/engines/parameter';
import { formatValue } from './layout';

/** The feature that made a named hole face or edge: `f:<feature>:wall:…`, `bore`, `sink`, `floor`. */
const holeFeatureOf = (name: string) => /(?:^|[|&:])f:([^:|&~@]+):(?:wall|bore|sink|floor|tip)/.exec(name)?.[1];

/**
 * What a hole callout says about the circle `name` (radius `radius` mm): from its hole feature
 * (count, diameter, depth, counterbore or countersink, thread), from its thread feature for a
 * thread's circle (`thread:<feature>`, CAD-166), else its diameter.
 */
export function holeCallout(document: ComponentDocument | undefined, projectParameters: readonly Parameter[], name: string, radius: number, parameters: ParameterEngine): string[] {
  // A thread's own circle (CAD-166): a tapped hole says what its hole does, a threaded shaft its size and length.
  const threaded = /(?:^|\/)thread:([^:/]+)$/.exec(name)?.[1];
  const thread = threaded === undefined ? undefined : document?.timeline.find((i): i is ThreadFeature => i.id === threaded && i.type === 'thread');
  if (thread && !holeFeatureOf(thread.face.name)) {
    const length = thread.length.trim() && document ? valueOf(document, projectParameters, parameters)(thread.length) : '';
    return [`${thread.size} thread`, ...(length ? [`length ${length}`] : [])];
  }
  const id = holeFeatureOf(thread?.face.name ?? name);
  const hole = document?.timeline.find((i): i is HoleFeature => i.id === id && i.type === 'hole');
  if (!document || !hole) return [`⌀${formatValue(2 * radius)}`];
  const value = valueOf(document, projectParameters, parameters);
  const count = hole.points.length > 1 ? `${hole.points.length} × ` : '';
  const tapped = document.timeline.find((i): i is ThreadFeature => i.type === 'thread' && holeFeatureOf(i.face.name) === hole.id);
  const lines = [`${count}⌀${value(hole.diameter)} ${hole.extent === 'through' ? 'thru' : `depth ${value(hole.depth)}`}`];
  if (hole.kind === 'counterbore') lines.push(`counterbore ⌀${value(hole.boreDiameter)} depth ${value(hole.boreDepth)}`);
  if (hole.kind === 'countersink') lines.push(`countersink ⌀${value(hole.sinkDiameter)} × ${value(hole.sinkAngle, 'angle')}°`);
  if (tapped) lines.unshift(`${count}${tapped.size} thread${tapped.length ? ` depth ${value(tapped.length)}` : ''}`);
  return lines;
}

/** Evaluates expressions of the component (lengths in mm, angles in degrees) as texts, or the expression where it fails. */
function valueOf(document: ComponentDocument, projectParameters: readonly Parameter[], parameters: ParameterEngine): (expression: string, kind?: 'length' | 'angle') => string {
  const own = new Set(document.parameters.map((p) => p.name));
  const evaluated = parameters.evaluateAll([...projectParameters.filter((p) => !own.has(p.name)), ...document.parameters]);
  const scope = evaluated.ok ? evaluated.value : new Map();
  return (expression, kind = 'length') => {
    const result = parameters.evaluate(expression, kind, scope);
    return result.ok ? formatValue(kind === 'angle' ? (result.value * 180) / Math.PI : result.value) : expression;
  };
}
