import { fail, ok, pluginApiVersion, type PluginExporter, type PluginPart, type ProjectPlugin, type Result, type ScriptParameter, type Vec2 } from '@core/contracts';
import { runSandboxed, type SandboxOptions, type SandboxOutcome } from '@core/utilities/sandbox';

/** A solid a plugin feature makes: a closed outline (and holes) in its plane, extruded by `height` from `z` (mm). */
export interface PluginSolid {
  readonly outline: readonly Vec2[];
  readonly holes: readonly (readonly Vec2[])[];
  readonly height: number;
  readonly z: number;
}

/** What an exporter gets: a component's bodies as triangles, in mm. */
export interface PluginModel {
  readonly name: string;
  readonly bodies: readonly { readonly id: string; readonly positions: readonly number[]; readonly indices: readonly number[] }[];
}

/**
 * Runs what plugins compute, in the script sandbox ([[Architecture/Decisions#ADR-60a]]): their
 * descriptions, the solids of their features (pure, cached by values) and the files of their exporters.
 */
export interface PluginEngine {
  /** A plugin's description from its source (one JavaScript file whose body returns the plugin), checked. */
  read(source: string): Promise<Result<ProjectPlugin>>;
  /** The solids of a plugin feature for these values (lengths in mm, angles in degrees). */
  build(plugin: ProjectPlugin, feature: string, values: Readonly<Record<string, number | string>>): Promise<Result<readonly PluginSolid[]>>;
  /** The text of the file an exporter writes for the model. */
  export(plugin: ProjectPlugin, exporter: string, model: PluginModel): Promise<Result<string>>;
}

/** Runs sandboxed code; the default is QuickJS (tests may count the runs). */
export type Sandbox = (source: string, options: SandboxOptions) => Promise<SandboxOutcome>;

export function createPluginEngine(sandbox: Sandbox = runSandboxed): PluginEngine {
  return new SandboxedPluginEngine(sandbox);
}

const idPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const namePattern = /^[A-Za-z_$][\w$]*$/;
const kinds: readonly ScriptParameter['kind'][] = ['number', 'length', 'angle', 'text'];

/** The plugin's source run as a function: its lines keep their numbers in error messages. */
const loaded = (source: string) => `const plugin = (() => {${source}\n})();
if (!plugin || typeof plugin !== 'object') throw new Error('A plugin returns its description: return { id, name, version, cadence: ${pluginApiVersion}, features, generators, exporters }.');`;

const describe = `
const parts = (group, run) => Object.entries(plugin[group] ?? {}).map(([name, part]) => ({
  name, label: String(part?.label ?? name), parameters: Array.isArray(part?.parameters) ? part.parameters : [], runs: typeof part?.[run] === 'function',
  extension: part?.extension, mediaType: part?.mediaType,
}));
return { id: plugin.id, name: plugin.name, version: plugin.version, api: plugin.cadence,
  features: parts('features', 'build'), generators: parts('generators', 'run'), exporters: parts('exporters', 'export') };`;

interface Described {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly version?: unknown;
  readonly api?: unknown;
  readonly features: readonly RawPart[];
  readonly generators: readonly RawPart[];
  readonly exporters: readonly RawPart[];
}
interface RawPart {
  readonly name: string;
  readonly label: string;
  readonly parameters: readonly Record<string, unknown>[];
  readonly runs: boolean;
  readonly extension?: unknown;
  readonly mediaType?: unknown;
}

class SandboxedPluginEngine implements PluginEngine {
  /** Solids by plugin, version, feature and values: regenerations reuse them. */
  private readonly solids = new Map<string, Promise<Result<readonly PluginSolid[]>>>();

  constructor(private readonly sandbox: Sandbox) {}

  async read(source: string): Promise<Result<ProjectPlugin>> {
    const outcome = await this.sandbox(`${loaded(source)}\n${describe}`, { timeLimit: 10_000, memoryLimit: 64 * 1024 * 1024 });
    if (!outcome.ok) return fail({ code: 'invalid-plugin', message: `The plugin did not load: ${outcome.error}` });
    const described = outcome.value as Described;
    const invalid = (message: string) => fail({ code: 'invalid-plugin', message });
    if (typeof described.id !== 'string' || !idPattern.test(described.id)) return invalid('A plugin needs an id of lower case letters, digits and dots, such as "acme.trays".');
    if (typeof described.name !== 'string' || !described.name.trim()) return invalid(`The plugin ${described.id} needs a name.`);
    if (typeof described.version !== 'string' || !versionPattern.test(described.version)) return invalid(`The plugin ${described.id} needs a version such as "1.0.0".`);
    if (described.api !== pluginApiVersion) {
      return fail({ code: 'unsupported-plugin', message: `The plugin ${described.id} was written for plugin API ${String(described.api)}; this CADence runs plugin API ${pluginApiVersion}.` });
    }
    const parts = (group: 'features' | 'generators' | 'exporters', run: string): Result<PluginPart[]> => {
      const checked: PluginPart[] = [];
      for (const part of described[group]) {
        if (!part.runs) return invalid(`The plugin's ${group.slice(0, -1)} "${part.name}" has no ${run} function.`);
        const parameters: ScriptParameter[] = [];
        for (const raw of part.parameters) {
          const kind = (raw['kind'] ?? 'number') as ScriptParameter['kind'];
          if (typeof raw['name'] !== 'string' || !namePattern.test(raw['name'])) return invalid(`A parameter of "${part.name}" needs a name that is a JavaScript identifier.`);
          if (!kinds.includes(kind)) return invalid(`The parameter ${raw['name']} of "${part.name}" has an unknown kind "${String(kind)}" (${kinds.join(', ')}).`);
          parameters.push({ name: raw['name'], ...(typeof raw['label'] === 'string' ? { label: raw['label'] } : {}), default: String(raw['default'] ?? ''), kind });
        }
        checked.push({ name: part.name, label: part.label, parameters });
      }
      return ok(checked);
    };
    const features = parts('features', 'build');
    if (!features.ok) return features;
    const generators = parts('generators', 'run');
    if (!generators.ok) return generators;
    const exporters: PluginExporter[] = [];
    for (const part of described.exporters) {
      if (!part.runs) return invalid(`The plugin's exporter "${part.name}" has no export function.`);
      if (typeof part.extension !== 'string' || !/^[a-z0-9]+$/i.test(part.extension)) return invalid(`The exporter "${part.name}" needs a file extension, such as "scad".`);
      exporters.push({ name: part.name, label: part.label, extension: part.extension.toLowerCase(), mediaType: typeof part.mediaType === 'string' ? part.mediaType : 'text/plain' });
    }
    return ok({ id: described.id, name: described.name, version: described.version, api: pluginApiVersion, features: features.value, generators: generators.value, exporters, source });
  }

  build(plugin: ProjectPlugin, feature: string, values: Readonly<Record<string, number | string>>): Promise<Result<readonly PluginSolid[]>> {
    const key = `${plugin.id}@${plugin.version}/${feature}/${JSON.stringify(values)}#${plugin.source.length}`;
    let built = this.solids.get(key);
    if (!built) {
      built = this.buildAnew(plugin, feature, values);
      this.solids.set(key, built);
      if (this.solids.size > 64) this.solids.delete(this.solids.keys().next().value as string);
    }
    return built;
  }

  private async buildAnew(plugin: ProjectPlugin, feature: string, values: Readonly<Record<string, number | string>>): Promise<Result<readonly PluginSolid[]>> {
    if (!plugin.features.some((f) => f.name === feature)) return fail({ code: 'missing-input', message: `The plugin ${plugin.name} ${plugin.version} has no feature "${feature}".` });
    const outcome = await this.sandbox(`${loaded(plugin.source)}\nreturn await plugin.features[call.name].build(call.values);`, {
      globals: { call: { name: feature, values } },
      timeLimit: 10_000,
      memoryLimit: 64 * 1024 * 1024,
    });
    if (!outcome.ok) return fail({ code: 'feature-failed', message: `${plugin.name}: ${outcome.error}` });
    return solidsOf(outcome.value, plugin.name);
  }

  async export(plugin: ProjectPlugin, exporter: string, model: PluginModel): Promise<Result<string>> {
    if (!plugin.exporters.some((e) => e.name === exporter)) return fail({ code: 'missing-input', message: `The plugin ${plugin.name} has no exporter "${exporter}".` });
    const outcome = await this.sandbox(`${loaded(plugin.source)}\nreturn await plugin.exporters[call.name].export(call.model);`, { globals: { call: { name: exporter, model } }, timeLimit: 60_000 });
    if (!outcome.ok) return fail({ code: 'export-failed', message: `${plugin.name}: ${outcome.error}` });
    if (typeof outcome.value !== 'string') return fail({ code: 'export-failed', message: `${plugin.name}: an exporter returns the file's text.` });
    return ok(outcome.value);
  }
}

const isPoint = (p: unknown): p is Vec2 => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));
const isLoop = (loop: unknown): loop is Vec2[] => Array.isArray(loop) && loop.length >= 3 && loop.every(isPoint);

/** The solids a feature returned, checked: outlines of three points or more, positive heights. */
function solidsOf(value: unknown, plugin: string): Result<readonly PluginSolid[]> {
  const invalid = (message: string) => fail({ code: 'feature-failed', message: `${plugin}: ${message}` });
  if (!Array.isArray(value) || value.length === 0) return invalid('a feature returns a list of solids: [{ outline: [[x, y], …], height }].');
  if (value.length > 500) return invalid('a feature makes 500 solids at most.');
  const solids: PluginSolid[] = [];
  for (const [i, raw] of value.entries()) {
    const solid = (raw ?? {}) as { outline?: unknown; holes?: unknown; height?: unknown; z?: unknown };
    if (!isLoop(solid.outline)) return invalid(`solid ${i + 1} needs an outline of three points or more ([x, y] in mm).`);
    const holes = solid.holes ?? [];
    if (!Array.isArray(holes) || !holes.every(isLoop)) return invalid(`the holes of solid ${i + 1} are outlines of three points or more.`);
    if (typeof solid.height !== 'number' || !(solid.height > 0) || !Number.isFinite(solid.height)) return invalid(`solid ${i + 1} needs a height greater than zero.`);
    const z = solid.z ?? 0;
    if (typeof z !== 'number' || !Number.isFinite(z)) return invalid(`the z of solid ${i + 1} is a number (mm).`);
    solids.push({ outline: solid.outline, holes, height: solid.height, z });
  }
  return ok(solids);
}
