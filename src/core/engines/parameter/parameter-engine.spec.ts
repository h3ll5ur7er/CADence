import { describe, expect, it } from 'vitest';
import { createParameterEngine, type ValueKind } from './index';

const engine = createParameterEngine();

function value(expression: string, kind: ValueKind = 'length', scope = new Map()): number {
  const result = engine.evaluate(expression, kind, scope);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function error(expression: string, kind: ValueKind = 'length'): string {
  const result = engine.evaluate(expression, kind);
  if (result.ok) throw new Error(`expected an error for ${expression}`);
  return result.error.message;
}

describe('ParameterEngine', () => {
  it('reads plain numbers in the default unit (mm, degrees)', () => {
    expect(value('25')).toBe(25);
    expect(value('2.5e1')).toBe(25);
    expect(value('90', 'angle')).toBeCloseTo(Math.PI / 2);
  });

  it('converts units to millimetres and radians', () => {
    expect(value('1 in')).toBeCloseTo(25.4);
    expect(value('2cm')).toBe(20);
    expect(value('0.5 m')).toBe(500);
    expect(value('180 deg', 'angle')).toBeCloseTo(Math.PI);
    expect(value('1 rad', 'angle')).toBe(1);
  });

  it('applies operator precedence and parentheses', () => {
    expect(value('2 + 3 * 4')).toBe(14);
    expect(value('(2 + 3) * 4')).toBe(20);
    expect(value('2 ^ 3 ^ 2', 'scalar')).toBe(512);
    expect(value('-2 ^ 2', 'scalar')).toBe(-4);
    expect(value('10 mm - -5 mm')).toBe(15);
  });

  it('mixes plain numbers with lengths', () => {
    expect(value('2 * 10 mm')).toBe(20);
    expect(value('10 mm + 5')).toBe(15);
    expect(value('1 in / 2')).toBeCloseTo(12.7);
    expect(value('20 mm / 4 mm', 'scalar')).toBe(5);
  });

  it('supports functions and constants', () => {
    expect(value('sqrt(9 mm * 16 mm)')).toBe(12);
    expect(value('max(3 mm, 1 cm)')).toBe(10);
    expect(value('sin(30)', 'scalar')).toBeCloseTo(0.5);
    expect(value('2 * pi', 'scalar')).toBeCloseTo(2 * Math.PI);
    expect(value('atan(1)', 'angle')).toBeCloseTo(Math.PI / 4);
    expect(value('round(2.6)')).toBe(3);
  });

  it('resolves names from the scope', () => {
    const scope = new Map([['wall', { value: 2, length: 1, angle: 0 }]]);
    expect(value('wall * 3 + 1', 'length', scope)).toBe(7);
  });

  it('explains what is wrong', () => {
    expect(error('')).toMatch(/Enter a value/);
    expect(error('2 +')).toMatch(/Unexpected end/);
    expect(error('2 * width')).toMatch(/Unknown name "width"/);
    expect(error('10 mm + 5 deg')).toMatch(/Cannot add/);
    expect(error('10 mm * 10 mm')).toMatch(/Expected a length/);
    expect(error('45 deg')).toMatch(/Expected a length/);
    expect(error('5 / 0')).toMatch(/not a finite number/);
    expect(error('3 $ 4')).toMatch(/Unexpected "\$"/);
    expect(error('foo(2)')).toMatch(/Unknown function "foo"/);
  });
});

describe('ParameterEngine.evaluateAll', () => {
  const p = (name: string, expression: string) => ({ id: name, name, expression });

  it('evaluates parameters in dependency order, whatever their listed order', () => {
    const result = engine.evaluateAll([p('height', 'wall * 4'), p('wall', '2 mm'), p('angle', '30 deg'), p('count', '3')]);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.get('height')).toEqual({ value: 8, length: 1, angle: 0 });
    expect(result.value.get('angle')?.value).toBeCloseTo(Math.PI / 6);
    expect(result.value.get('count')).toEqual({ value: 3, length: 0, angle: 0 });
  });

  it('reports cycles, unknown names and invalid names', () => {
    expect(engine.evaluateAll([p('a', 'b + 1'), p('b', 'a * 2')])).toMatchObject({ ok: false, error: { message: expect.stringMatching(/a → b → a|b → a → b/) } });
    expect(engine.evaluateAll([p('a', 'missing * 2')])).toMatchObject({ ok: false, error: { message: expect.stringContaining('Unknown name "missing"'), parameter: 'a' } });
    expect(engine.evaluateAll([p('mm', '2')])).toMatchObject({ ok: false, error: { message: expect.stringContaining('reserved') } });
    expect(engine.evaluateAll([p('2x', '2')])).toMatchObject({ ok: false, error: { message: expect.stringContaining('letter') } });
    expect(engine.evaluateAll([p('a', '1'), p('a', '2')])).toMatchObject({ ok: false, error: { message: expect.stringContaining('twice') } });
  });

  it('lists the names an expression uses', () => {
    expect(engine.namesIn('max(wall, 2 mm) * count + sin(30)')).toEqual(['wall', 'count']);
    expect(engine.namesIn('2 +')).toEqual([]);
  });
});
