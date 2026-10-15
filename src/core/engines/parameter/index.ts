import { fail, ok, type Result } from '@core/contracts';
import { describeDimension, evaluateQuantity, ExpressionError, type Quantity } from './expression';

export type { Quantity } from './expression';

/** What a value is used for; decides the default unit of plain numbers and the expected dimension. */
export type ValueKind = 'length' | 'angle' | 'scalar';

/**
 * Evaluates expressions with units (see docs/Architecture/Document-model.md#parameters).
 * Pure and fast, so it is synchronous; results are in millimetres and radians.
 */
export interface ParameterEngine {
  evaluate(expression: string, kind: ValueKind, scope?: ReadonlyMap<string, Quantity>): Result<number>;
}

const expected: Readonly<Record<ValueKind, { length: number; angle: number; label: string }>> = {
  length: { length: 1, angle: 0, label: 'a length' },
  angle: { length: 0, angle: 1, label: 'an angle' },
  scalar: { length: 0, angle: 0, label: 'a plain number' },
};

const degree = Math.PI / 180;

class DefaultParameterEngine implements ParameterEngine {
  evaluate(expression: string, kind: ValueKind, scope: ReadonlyMap<string, Quantity> = new Map()): Result<number> {
    try {
      const quantity = evaluateQuantity(expression, scope);
      const target = expected[kind];
      const plain = quantity.length === 0 && quantity.angle === 0;
      let value: number;
      if (quantity.length === target.length && quantity.angle === target.angle) value = quantity.value;
      else if (plain) value = kind === 'angle' ? quantity.value * degree : quantity.value;
      else return fail({ code: 'wrong-unit', message: `Expected ${target.label}, got ${describeDimension(quantity)}.` });
      if (!Number.isFinite(value)) return fail({ code: 'invalid-value', message: 'The result is not a finite number.' });
      return ok(value);
    } catch (error) {
      if (error instanceof ExpressionError) return fail({ code: 'invalid-expression', message: error.message });
      throw error;
    }
  }
}

export function createParameterEngine(): ParameterEngine {
  return new DefaultParameterEngine();
}
