import { type Configuration, fail, ok, type Parameter, type Result } from '@core/contracts';
import type { ParameterEngine } from '@core/engines/parameter';
import { parseCsv, toCsv } from '@core/utilities/csv';
import { newId } from '@core/utilities/identity';

/** A configuration table read from CSV, and how it differs from the one in the component. */
export interface ConfigurationImport {
  readonly configurations: readonly Configuration[];
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  /** Configurations whose values do not evaluate, each with why. */
  readonly problems: readonly string[];
}

const invalid = (message: string) => fail({ code: 'invalid-file', message });

/** The configuration table as CSV: a row per configuration, a column per parameter; empty cells keep the parameter's own value. */
export function configurationsCsv(configurations: readonly Configuration[], names: readonly string[]): string {
  return toCsv([['Configuration', ...names], ...configurations.map((c) => [c.name, ...names.map((n) => c.values[n] ?? '')])]);
}

/**
 * Reads a configuration table from CSV in the format `configurationsCsv` writes. Columns must name
 * parameters (`parameters`: those in effect, with their own expressions); configurations keep their
 * ids by name. Every configuration is evaluated, so problems show before the table is applied.
 */
export function readConfigurationsCsv(text: string, parameters: readonly Parameter[], existing: readonly Configuration[], engine: ParameterEngine): Result<ConfigurationImport> {
  const [header, ...rows] = parseCsv(text);
  if (!header) return invalid('The file is empty.');
  const columns = header.slice(1).map((c) => c.trim());
  const known = new Set(parameters.map((p) => p.name));
  const unknown = columns.filter((c) => !known.has(c));
  if (unknown.length) return invalid(`No parameter is called ${unknown.join(', ')}. The first row names the parameters, after the configuration names.`);
  if (new Set(columns).size < columns.length) return invalid('A parameter has two columns.');
  const names = rows.map((row) => (row[0] ?? '').trim());
  if (names.some((n) => !n)) return invalid('Every row needs a configuration name in its first column.');
  if (new Set(names).size < names.length) return invalid('Configuration names must differ.');

  const byName = new Map(existing.map((c) => [c.name, c]));
  const configurations = rows.map((row, r): Configuration => {
    const values = Object.fromEntries(columns.flatMap((name, i) => ((row[i + 1] ?? '').trim() ? [[name, (row[i + 1] as string).trim()]] : [])));
    return { id: byName.get(names[r] as string)?.id ?? newId(), name: names[r] as string, values };
  });
  const same = (a: Configuration, b: Configuration) => JSON.stringify(Object.entries(a.values).sort()) === JSON.stringify(Object.entries(b.values).sort());
  const problems = configurations.flatMap((c) => {
    const evaluated = engine.evaluateAll(parameters.map((p) => (p.name in c.values ? { ...p, expression: c.values[p.name] as string } : p)));
    return evaluated.ok ? [] : [`${c.name}: ${evaluated.error.message}`];
  });
  return ok({
    configurations,
    added: configurations.filter((c) => !byName.has(c.name)).map((c) => c.name),
    changed: configurations.filter((c) => byName.has(c.name) && !same(c, byName.get(c.name) as Configuration)).map((c) => c.name),
    removed: existing.filter((c) => !names.includes(c.name)).map((c) => c.name),
    problems,
  });
}
