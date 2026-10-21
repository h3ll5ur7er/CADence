import type { DocumentSummary, ProjectSummary, ScriptParameter } from '@core/contracts';
import { runSandboxed, type SandboxHost, type SandboxOptions, type SandboxOutcome } from '@core/utilities/sandbox';
import { AssemblyScript, type Cadence, CadenceError, ComponentScript } from './api';
import { DrawingScript } from './drawing';
import { type ScriptKind, scriptMembers } from './script-api';

/**
 * Scripts in the sandbox against the scripting API ([[Architecture/Decisions#ADR-60]]): the host side
 * of the membrane, and runs of scripts, kept scripts and plugin generators. Runs in Node and the browser.
 */

/** A document a script made, changed or deleted, with its project's name. */
export interface TouchedDocument {
  readonly id: string;
  readonly name: string;
  readonly kind: DocumentSummary['kind'];
  readonly project: string;
}

export interface DocumentChanges {
  readonly created: readonly TouchedDocument[];
  readonly changed: readonly TouchedDocument[];
  readonly deleted: readonly TouchedDocument[];
}

/** How a script run ended: its value or error, what it printed, and the documents it touched. */
export type ScriptRun = SandboxOutcome & { readonly documents: DocumentChanges; readonly seconds: number };

/** Runs sandboxed code: QuickJS in this thread, or the app's worker. */
export type ScriptSandbox = (source: string, options: SandboxOptions) => Promise<SandboxOutcome>;

export interface ScriptOptions {
  /** The script's `params`: named values (the console's form, a generator's parameters). */
  readonly params?: Readonly<Record<string, unknown>>;
  /** The script's `args`: any JSON (run_script's arguments). */
  readonly args?: unknown;
  /** The project the script runs for (`project` inside it: id and name). */
  readonly project?: Pick<ProjectSummary, 'id' | 'name'>;
  /** Milliseconds (2 minutes by default). */
  readonly timeLimit?: number;
  readonly signal?: AbortSignal;
  readonly onOutput?: (line: string) => void;
  /** Where an export's `to` path may go: returns the path to use, or throws (no files outside exports). */
  readonly checkPath?: (path: string) => string;
  readonly sandbox?: ScriptSandbox;
}

/** Bytes as base64 (pictures), in Node and the browser. */
function base64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

const typeNames: Readonly<Record<ScriptKind, string>> = { cadence: 'cadence', projects: 'cadence.projects', component: 'A component', assembly: 'An assembly', drawing: 'A drawing' };

/**
 * The host side of the membrane: objects the script holds by handle, the calls it makes on them
 * (only the members of the script API), and what those calls touched.
 */
export class ScriptHost {
  private readonly handles = new Map<number, { readonly kind: ScriptKind; readonly target: object }>();
  /** Strings the script passed or got (ids among them): which projects it worked on. */
  private readonly seen = new Set<string>();
  private readonly deleted: TouchedDocument[] = [];
  private readonly started = new Date(Date.now() - 1).toISOString();

  constructor(
    private readonly cadence: Cadence,
    private readonly checkPath?: (path: string) => string,
  ) {
    this.handles.set(0, { kind: 'cadence', target: cadence });
    this.handles.set(1, { kind: 'projects', target: cadence.projects });
  }

  /** The sandbox's `host('call', handle, member, args)`. */
  readonly host: SandboxHost = async (name, args) => {
    if (name !== 'call') throw new Error(`There is no host function ${name}.`);
    const [handle, member, values = []] = args as [number, string, unknown[]];
    const held = this.handles.get(handle);
    if (!held) throw new Error('This object is no longer open.');
    if (!scriptMembers[held.kind].some((m) => m.name === member)) throw new Error(`${typeNames[held.kind]} has no ${member}.`);
    const given = values.map((value) => this.argument(value));
    this.remember(given);
    if (held.kind === 'projects' && member === 'deleteDocument') await this.deleting(String(given[0]));
    if (held.kind === 'projects' && member === 'deleteProject') for (const d of await this.cadence.projects.listDocuments(String(given[0]) as never)) await this.deleting(d.id);
    try {
      const result: unknown = await (held.target as Record<string, (...a: unknown[]) => unknown>)[member]?.(...given);
      return this.encode(result);
    } catch (error) {
      if (error instanceof CadenceError) throw new Error(`${error.message} (${error.code})`);
      throw error;
    }
  };

  /** The documents the script made, changed and deleted: those of projects it worked on, by their times. */
  async documents(): Promise<DocumentChanges> {
    const projects = await this.cadence.projects.listProjects();
    const touched = projects.filter((p) => p.createdAt >= this.started || p.modifiedAt >= this.started || this.seen.has(p.id));
    const created: TouchedDocument[] = [];
    const changed: TouchedDocument[] = [];
    for (const project of touched) {
      for (const d of await this.cadence.projects.listDocuments(project.id)) {
        const entry = { id: d.id, name: d.name, kind: d.kind, project: project.name };
        if (d.createdAt >= this.started) created.push(entry);
        else if (d.modifiedAt >= this.started) changed.push(entry);
      }
    }
    return { created, changed, deleted: this.deleted };
  }

  private async deleting(id: string): Promise<void> {
    const document = await this.cadence.projects.findDocument(id as never);
    if (!document) return;
    const project = await this.cadence.projects.findProject(document.projectId);
    if (document.createdAt < this.started) this.deleted.push({ id: document.id, name: document.name, kind: document.kind, project: project?.name ?? '' });
  }

  /** An argument as the API takes it: `to` paths checked (or moved) into the exports folder. */
  private argument(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('to' in value)) return value;
    const to = (value as { to?: unknown }).to;
    if (typeof to !== 'string' || !this.checkPath) return value;
    return { ...value, to: this.checkPath(to) };
  }

  private remember(value: unknown): void {
    if (this.seen.size > 10_000) return;
    if (typeof value === 'string') this.seen.add(value);
    else if (Array.isArray(value)) value.forEach((v) => this.remember(v));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => this.remember(v));
  }

  /** A result as data for the sandbox: open documents as handles, bytes as base64, Maps as objects. */
  private encode(value: unknown): unknown {
    const kind: ScriptKind | undefined =
      value instanceof ComponentScript ? 'component' : value instanceof AssemblyScript ? 'assembly' : value instanceof DrawingScript ? 'drawing' : undefined;
    if (kind && value) {
      const handle = this.handles.size;
      this.handles.set(handle, { kind, target: value });
      this.seen.add((value as ComponentScript).state().document.projectId);
      return { $handle: handle, kind };
    }
    if (value instanceof Uint8Array) return base64(value);
    if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), this.encode(v)]));
    if (Array.isArray(value)) return value.map((v) => this.encode(v));
    if (value && typeof value === 'object') {
      this.remember((value as { id?: unknown }).id);
      this.remember((value as { projectId?: unknown }).projectId);
      return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v !== 'function').map(([k, v]) => [k, this.encode(v)]));
    }
    return value;
  }
}

/**
 * Builds `cadence` inside the sandbox from the script API's members: stand-ins whose calls go to the
 * host. One line, so the script's own lines keep their numbers.
 */
const prelude = `const cadence = (() => { const call = host; delete globalThis.host;
const members = ${JSON.stringify(Object.fromEntries(Object.entries(scriptMembers).map(([kind, list]) => [kind, list.map((m) => m.name)])))};
const wrap = (value) => { if (Array.isArray(value)) return value.map(wrap); if (value && typeof value === 'object') { if (typeof value.$handle === 'number') return stand(value.$handle, value.kind); for (const key of Object.keys(value)) value[key] = wrap(value[key]); } return value; };
const stand = (handle, kind) => Object.freeze(Object.fromEntries(members[kind].map((name) => [name, async (...args) => wrap(await call('call', handle, name, args))])));
return Object.freeze({ ...stand(0, 'cadence'), projects: stand(1, 'projects') }); })();`.replace(/\n/g, ' ');

/**
 * Runs a script (the body of an async function with `cadence`, `params`, `args` and `project`) in the
 * sandbox, and answers with its value, what it printed and the documents it touched.
 */
export async function runScript(cadence: Cadence, source: string, options: ScriptOptions = {}): Promise<ScriptRun> {
  const host = new ScriptHost(cadence, options.checkPath);
  const started = Date.now();
  const outcome = await (options.sandbox ?? runSandboxed)(`${prelude}${source}`, {
    globals: { params: options.params ?? {}, args: options.args ?? null, project: options.project ? { id: options.project.id, name: options.project.name } : null },
    host: host.host,
    timeLimit: options.timeLimit ?? 120_000,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onOutput ? { onOutput: options.onOutput } : {}),
  });
  // Results still being written (components rebuilt for assemblies) belong to the run.
  await cadence.settled();
  return { ...outcome, documents: await host.documents(), seconds: Math.round((Date.now() - started) / 100) / 10 };
}

/** Parameter values from text (a form, an agent's arguments), as a script gets them: numbers where they are numbers. */
export function parameterValues(parameters: readonly ScriptParameter[], given: Readonly<Record<string, unknown>> = {}): Record<string, number | string> {
  const values: Record<string, number | string> = {};
  for (const parameter of parameters) {
    const raw = given[parameter.name] ?? parameter.default;
    if (parameter.kind === 'text') {
      values[parameter.name] = String(raw);
      continue;
    }
    if (typeof raw === 'number') {
      values[parameter.name] = raw;
      continue;
    }
    // "20", "20 mm", "45 deg": the number; lengths in mm and angles in degrees are what scripts expect.
    const match = /^\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(mm|cm|m|in|deg|°)?\s*$/i.exec(String(raw));
    if (!match) throw new CadenceError('invalid-parameter', `${parameter.label ?? parameter.name} needs a number${parameter.kind === 'length' ? ' (mm)' : parameter.kind === 'angle' ? ' (degrees)' : ''}, not “${String(raw)}”.`);
    const scale = { mm: 1, cm: 10, m: 1000, in: 25.4 }[(match[2] ?? '').toLowerCase()] ?? 1;
    values[parameter.name] = Number(match[1]) * scale;
  }
  // Values the script does not declare pass as they are.
  for (const [name, value] of Object.entries(given)) if (!(name in values) && (typeof value === 'number' || typeof value === 'string')) values[name] = value;
  return values;
}

/**
 * Runs a script kept with a project, by name or id, or a plugin's generator (`<plugin id>/<generator>`),
 * with its parameters: the given ones, else their defaults.
 */
export async function runGenerator(cadence: Cadence, projectIdOrName: string, generator: string, given: Readonly<Record<string, unknown>> = {}, options: Omit<ScriptOptions, 'params' | 'project'> = {}): Promise<ScriptRun> {
  const summary = await cadence.project(projectIdOrName);
  const project = (await cadence.projects.findProject(summary.id)) ?? summary;
  const kept = project.scripts?.find((s) => s.name === generator || s.id === generator);
  if (kept) return runScript(cadence, kept.source, { ...options, params: parameterValues(kept.parameters, given), project });
  const slash = generator.lastIndexOf('/');
  const plugin = slash > 0 ? project.plugins?.find((p) => p.id === generator.slice(0, slash)) : undefined;
  const part = plugin?.generators.find((g) => g.name === generator.slice(slash + 1));
  if (!plugin || !part) {
    const names = [...(project.scripts ?? []).map((s) => s.name), ...(project.plugins ?? []).flatMap((p) => p.generators.map((g) => `${p.id}/${g.name}`))];
    throw new CadenceError('unknown-generator', `${project.name} has no script or generator “${generator}”.${names.length ? ` It has: ${names.join(', ')}.` : ''}`);
  }
  // The plugin's body runs as it does for its features; the generator gets the API, its values and the project.
  const source = `const plugin = (() => {${plugin.source}\n})();\nreturn await plugin.generators[${JSON.stringify(part.name)}].run(cadence, params, { project });`;
  return runScript(cadence, source, { ...options, params: parameterValues(part.parameters, given), project });
}
