import { type DomainError, fail, ok, type Parameter, type Result } from '@core/contracts';
import { describeDimension, evaluateQuantity, ExpressionError, type Quantity, referencedNames, reservedNames } from './expression';

export type { Quantity } from './expression';

/** What a value is used for; decides the default unit of plain numbers and the expected dimension. */
export type ValueKind = 'length' | 'angle' | 'scalar';

/**
 * Evaluates expressions with units (see docs/Architecture/Document-model.md#parameters).
 * Pure and fast, so it is synchronous; results are in millimetres and radians.
 */
export interface ParameterEngine {
  evaluate(expression: string, kind: ValueKind, scope?: ReadonlyMap<string, Quantity>): Result<number>;
  /** All parameters, each evaluated after the ones it uses; errors name the parameter. */
  evaluateAll(parameters: readonly Pick<Parameter, 'id' | 'name' | 'expression'>[]): Result<Map<string, Quantity>, ParameterError>;
  /** Parameter names an expression uses. */
  namesIn(expression: string): string[];
}

export interface ParameterError extends DomainError {
  /** Id of the parameter at fault, when there is one. */
  readonly parameter?: string;
}

const expected: Readonly<Record<ValueKind, { length: number; angle: number; label: string }>> = {
  length: { length: 1, angle: 0, label: 'a length' },
  angle: { length: 0, angle: 1, label: 'an angle' },
  scalar: { length: 0, angle: 0, label: 'a plain number' },
};

const degree = Math.PI / 180;

const validName = /^[A-Za-z_][A-Za-z0-9_]*$/;

class DefaultParameterEngine implements ParameterEngine {
  namesIn(expression: string): string[] {
    return referencedNames(expression);
  }

  evaluateAll(parameters: readonly Pick<Parameter, 'id' | 'name' | 'expression'>[]): Result<Map<string, Quantity>, ParameterError> {
    const byName = new Map<string, Pick<Parameter, 'id' | 'name' | 'expression'>>();
    for (const p of parameters) {
      const problem = !validName.test(p.name)
        ? 'must start with a letter and use only letters, digits and _'
        : reservedNames.has(p.name)
          ? 'is reserved for a unit, constant or function'
          : byName.has(p.name)
            ? 'is used twice'
            : undefined;
      if (problem) return fail({ code: 'invalid-name', message: `The name "${p.name}" ${problem}.`, parameter: p.id });
      byName.set(p.name, p);
    }
    const values = new Map<string, Quantity>();
    const visiting: string[] = [];
    const visit = (p: Pick<Parameter, 'id' | 'name' | 'expression'>): ParameterError | undefined => {
      if (values.has(p.name)) return undefined;
      if (visiting.includes(p.name)) {
        const cycle = [...visiting.slice(visiting.indexOf(p.name)), p.name].join(' → ');
        return { code: 'cycle', message: `These parameters depend on each other: ${cycle}.`, parameter: p.id };
      }
      visiting.push(p.name);
      for (const name of referencedNames(p.expression)) {
        const dependency = byName.get(name);
        if (!dependency) continue; // reported as an unknown name below
        const error = visit(dependency);
        if (error) return error;
      }
      visiting.pop();
      try {
        values.set(p.name, evaluateQuantity(p.expression, values));
      } catch (error) {
        const message = error instanceof ExpressionError ? error.message : String(error);
        return { code: 'invalid-expression', message: `${p.name} = ${p.expression}: ${message}`, parameter: p.id };
      }
      return undefined;
    };
    for (const p of parameters) {
      const error = visit(p);
      if (error) return fail(error);
    }
    return ok(values);
  }

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
