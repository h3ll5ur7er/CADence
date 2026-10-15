/**
 * Expression evaluation with units and dimensional analysis.
 * Grammar:  expr  := term (('+' | '-') term)*
 *           term  := unary (('*' | '/') unary)*
 *           unary := ('+' | '-') unary | power
 *           power := primary ('^' unary)?
 *           primary := (number | name | call | '(' expr ')') unit?
 */

/** A value with the exponents of its length and angle dimensions; mm and radians internally. */
export interface Quantity {
  readonly value: number;
  readonly length: number;
  readonly angle: number;
}

export class ExpressionError extends Error {}

const lengthUnits: Readonly<Record<string, number>> = { um: 0.001, mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };
const angleUnits: Readonly<Record<string, number>> = { deg: Math.PI / 180, rad: 1 };
const constants: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E };
const degree = Math.PI / 180;

const scalar = (value: number): Quantity => ({ value, length: 0, angle: 0 });
const isScalar = (q: Quantity) => q.length === 0 && q.angle === 0;
const sameDimension = (a: Quantity, b: Quantity) => a.length === b.length && a.angle === b.angle;

export function describeDimension(q: Pick<Quantity, 'length' | 'angle'>): string {
  if (q.length === 0 && q.angle === 0) return 'a plain number';
  if (q.length === 1 && q.angle === 0) return 'a length';
  if (q.length === 0 && q.angle === 1) return 'an angle';
  if (q.length === 2 && q.angle === 0) return 'an area';
  return 'a mixed unit';
}

/** A plain number standing in for a length or angle is read in the default unit (mm, degrees). */
function coerce(plain: Quantity, like: Quantity): Quantity {
  if (like.length === 0 && like.angle === 1) return { value: plain.value * degree, length: 0, angle: 1 };
  return { value: plain.value, length: like.length, angle: like.angle };
}

/** Trigonometric functions read plain numbers as degrees. */
function radians(q: Quantity, fn: string): number {
  if (q.angle === 1 && q.length === 0) return q.value;
  if (isScalar(q)) return q.value * degree;
  throw new ExpressionError(`${fn}() needs an angle, not ${describeDimension(q)}.`);
}

function sameKind(args: Quantity[], fn: string): Quantity[] {
  const reference = args.find((a) => !isScalar(a)) ?? args[0];
  if (!reference) throw new ExpressionError(`${fn}() needs at least one argument.`);
  return args.map((a) => {
    if (sameDimension(a, reference)) return a;
    if (isScalar(a)) return coerce(a, reference);
    throw new ExpressionError(`${fn}() needs values of the same kind.`);
  });
}

type Fn = (args: Quantity[]) => Quantity;

const unary = (fn: string, apply: (q: Quantity) => Quantity): Fn => (args) => {
  if (args.length !== 1) throw new ExpressionError(`${fn}() takes one argument.`);
  return apply(args[0] as Quantity);
};

const functions: Readonly<Record<string, Fn>> = {
  sin: unary('sin', (q) => scalar(Math.sin(radians(q, 'sin')))),
  cos: unary('cos', (q) => scalar(Math.cos(radians(q, 'cos')))),
  tan: unary('tan', (q) => scalar(Math.tan(radians(q, 'tan')))),
  asin: unary('asin', (q) => ({ value: Math.asin(q.value), length: 0, angle: 1 })),
  acos: unary('acos', (q) => ({ value: Math.acos(q.value), length: 0, angle: 1 })),
  atan: unary('atan', (q) => ({ value: Math.atan(q.value), length: 0, angle: 1 })),
  sqrt: unary('sqrt', (q) => {
    if (q.length % 2 !== 0 || q.angle % 2 !== 0) throw new ExpressionError(`sqrt() of ${describeDimension(q)} has no unit.`);
    return { value: Math.sqrt(q.value), length: q.length / 2, angle: q.angle / 2 };
  }),
  abs: unary('abs', (q) => ({ ...q, value: Math.abs(q.value) })),
  round: unary('round', (q) => ({ ...q, value: Math.round(q.value) })),
  floor: unary('floor', (q) => ({ ...q, value: Math.floor(q.value) })),
  ceil: unary('ceil', (q) => ({ ...q, value: Math.ceil(q.value) })),
  min: (args) => {
    const values = sameKind(args, 'min');
    return values.reduce((a, b) => (b.value < a.value ? b : a));
  },
  max: (args) => {
    const values = sameKind(args, 'max');
    return values.reduce((a, b) => (b.value > a.value ? b : a));
  },
};

type Token =
  | { readonly type: 'number'; readonly value: number; readonly at: number }
  | { readonly type: 'name'; readonly value: string; readonly at: number }
  | { readonly type: 'symbol'; readonly value: string; readonly at: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) {
      const at = index + (source.slice(index).length - source.slice(index).trimStart().length);
      throw new ExpressionError(`Unexpected "${source[at]}" at position ${at + 1}.`);
    }
    const at = match.index + match[0].length - (match[1] ?? match[2] ?? match[3] ?? '').length;
    if (match[1] !== undefined) tokens.push({ type: 'number', value: Number(match[1]), at });
    else if (match[2] !== undefined) tokens.push({ type: 'name', value: match[2], at });
    else tokens.push({ type: 'symbol', value: match[3] as string, at });
    index = pattern.lastIndex;
  }
  return tokens;
}

class Parser {
  private position = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly scope: ReadonlyMap<string, Quantity>,
  ) {}

  parse(): Quantity {
    const result = this.expression();
    const extra = this.peek();
    if (extra) throw new ExpressionError(`Unexpected "${extra.value}" at position ${extra.at + 1}.`);
    return result;
  }

  private expression(): Quantity {
    let left = this.term();
    for (let op = this.symbol('+', '-'); op; op = this.symbol('+', '-')) {
      left = add(left, this.term(), op === '-' ? -1 : 1);
    }
    return left;
  }

  private term(): Quantity {
    let left = this.unary();
    for (let op = this.symbol('*', '/'); op; op = this.symbol('*', '/')) {
      const right = this.unary();
      left =
        op === '*'
          ? { value: left.value * right.value, length: left.length + right.length, angle: left.angle + right.angle }
          : { value: left.value / right.value, length: left.length - right.length, angle: left.angle - right.angle };
    }
    return left;
  }

  private unary(): Quantity {
    const sign = this.symbol('+', '-');
    if (!sign) return this.power();
    const operand = this.unary();
    return sign === '-' ? { ...operand, value: -operand.value } : operand;
  }

  private power(): Quantity {
    const base = this.primary();
    if (!this.symbol('^')) return base;
    const exponent = this.unary();
    if (!isScalar(exponent)) throw new ExpressionError('Exponents must be plain numbers.');
    return {
      value: base.value ** exponent.value,
      length: base.length * exponent.value,
      angle: base.angle * exponent.value,
    };
  }

  private primary(): Quantity {
    const token = this.next();
    let result: Quantity;
    if (token.type === 'number') {
      result = scalar(token.value);
    } else if (token.type === 'name') {
      result = this.symbol('(') ? this.call(token.value) : this.name(token.value);
    } else if (token.value === '(') {
      result = this.expression();
      this.expect(')');
    } else {
      throw new ExpressionError(`Unexpected "${token.value}" at position ${token.at + 1}.`);
    }
    return this.unit(result);
  }

  private unit(q: Quantity): Quantity {
    const token = this.peek();
    if (token?.type !== 'name') return q;
    const lengthFactor = lengthUnits[token.value];
    const angleFactor = angleUnits[token.value];
    if (lengthFactor === undefined && angleFactor === undefined) return q;
    this.position++;
    return lengthFactor !== undefined
      ? { value: q.value * lengthFactor, length: q.length + 1, angle: q.angle }
      : { value: q.value * (angleFactor as number), length: q.length, angle: q.angle + 1 };
  }

  private call(name: string): Quantity {
    const fn = functions[name];
    if (!fn) throw new ExpressionError(`Unknown function "${name}".`);
    const args: Quantity[] = [];
    if (!this.symbol(')')) {
      do args.push(this.expression());
      while (this.symbol(','));
      this.expect(')');
    }
    return fn(args);
  }

  private name(name: string): Quantity {
    const fromScope = this.scope.get(name);
    if (fromScope) return fromScope;
    const constant = constants[name];
    if (constant !== undefined) return scalar(constant);
    throw new ExpressionError(`Unknown name "${name}".`);
  }

  private symbol(...symbols: string[]): string | undefined {
    const token = this.peek();
    if (token?.type === 'symbol' && symbols.includes(token.value)) {
      this.position++;
      return token.value;
    }
    return undefined;
  }

  private expect(symbol: string): void {
    if (!this.symbol(symbol)) {
      const token = this.peek();
      throw new ExpressionError(
        token ? `Expected "${symbol}" at position ${token.at + 1}.` : `Unexpected end, expected "${symbol}".`,
      );
    }
  }

  private next(): Token {
    const token = this.tokens[this.position++];
    if (!token) throw new ExpressionError('Unexpected end of the expression.');
    return token;
  }

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }
}

function add(a: Quantity, b: Quantity, sign: 1 | -1): Quantity {
  let left = a;
  let right = b;
  if (!sameDimension(left, right)) {
    if (isScalar(left)) left = coerce(left, right);
    else if (isScalar(right)) right = coerce(right, left);
    else throw new ExpressionError(`Cannot add ${describeDimension(a)} and ${describeDimension(b)}.`);
  }
  return { ...left, value: left.value + sign * right.value };
}

export function evaluateQuantity(source: string, scope: ReadonlyMap<string, Quantity>): Quantity {
  if (source.trim() === '') throw new ExpressionError('Enter a value.');
  return new Parser(tokenize(source), scope).parse();
}
