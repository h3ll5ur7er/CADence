import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNodeCore, type NodeResources } from '@core/composition/node';
import type { ImportFormat, RemoteCredentials, Vec3 } from '@core/contracts';
import type { DrawingFormat, SolidFormat } from '@core/managers/design';
import type { StoppablePort } from '@core/utilities/messaging';
import { Cadence, CadenceError, unwrap } from './api';
import { McpServer, serveStdio } from './mcp';
import type { ScriptSandbox } from './script';

export const usage = `CADence on the command line

Usage: cadence <command> [arguments] [options]

Commands:
  projects                              List the projects
  documents <project>                   List a project's documents
  export <project> <document> <format>  Export a component (step, stl, obj, 3mf; dxf or svg with --sketch <id> or --flat-pattern),
                                        an assembly (step, stl, obj, 3mf) or a drawing (pdf, dxf)
  picture <project> <document> <file>  A PNG of a component, an assembly or a drawing (--view iso|front|back|top|bottom|left|right or
                                        --direction x,y,z [--up x,y,z], --width, --height, --white, --focus/--hide/--ghost a,b;
                                        assemblies also --explode <view> [--steps n], --study <id> --time <s>)
  convert <input> <output>              Convert a file; formats from the extensions (step, stl, obj, 3mf, dxf, svg)
  run <script> [arguments]              Run a script: its default export is called with the API and the arguments
  install-plugin <project> <file>       Install a plugin (a .cadence-plugin.js file) into a project
  open-git <url>                        Open a project from a git repository (--cors-proxy <url>)
  sync <project>                        Sync a project with its git repository
  mcp                                   Serve CADence to AI agents over stdio (Model Context Protocol)

Options:
  --folder <dir>    The projects folder (default: $CADENCE_FOLDER, else the desktop app's folder)
  --exports <dir>   Where exported files go (default: the current folder; for mcp, "CADence exports" in the documents folder)
  -o <path>         The exported file's path

Projects and documents are given by id or by name. Git sign-in: $CADENCE_GIT_USERNAME and $CADENCE_GIT_PASSWORD.
`;

/** Where the desktop app keeps its projects (Tauri's app data folder for dev.cadence.app). */
export function desktopFolder(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const id = 'dev.cadence.app';
  if (platform === 'win32') return join(env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), id);
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', id);
  return join(env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), id);
}

/** Where the MCP server's files go by default: `CADence exports` in the documents folder (or the home folder). */
export function exportsDefault(): string {
  const documents = join(homedir(), 'Documents');
  return join(existsSync(documents) ? documents : homedir(), 'CADence exports');
}

interface Parsed {
  readonly positional: string[];
  readonly options: Record<string, string | true>;
}

/** Splits arguments into positional ones and options (`--name value`, `--flag`, `-o value`). */
export function parseArguments(args: readonly string[]): Parsed {
  const positional: string[] = [];
  const options: Record<string, string | true> = {};
  const flags = new Set(['flat-pattern', 'help']);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const name = arg.startsWith('--') ? arg.slice(2) : arg === '-o' ? 'o' : arg === '-h' ? 'help' : undefined;
    if (name === undefined) positional.push(arg);
    else if (flags.has(name)) options[name] = true;
    else options[name] = args[++i] ?? '';
  }
  return { positional, options };
}

const formatOf = (path: string): string => {
  const extension = extname(path).slice(1).toLowerCase();
  return extension === 'stp' ? 'step' : extension;
};

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

/** Runs one command line; returns the exit code. */
export async function runCli(
  args: readonly string[],
  io: Io,
  reference: Readonly<Record<string, string>> = {},
  version = '0.0.0',
  env: NodeJS.ProcessEnv = process.env,
  /**
   * Workers and files of the program: `views` draws drawing views exactly within a time limit
   * (CAD-125), `geometry` runs the kernel off this thread (CAD-134), `resources` are the kernels'
   * WebAssembly and the fonts when not in their packages (the self-contained binary, CAD-131).
   * Absent: all in this thread, from the packages. `guide` is the user guide's pages, for the MCP server;
   * `sandbox` runs its scripts (in a worker of their own; in this thread when absent).
   */
  host: {
    readonly views?: () => StoppablePort;
    readonly geometry?: () => StoppablePort;
    readonly resources?: NodeResources;
    readonly guide?: Readonly<Record<string, string>>;
    readonly sandbox?: ScriptSandbox;
  } = {},
): Promise<number> {
  const { positional, options } = parseArguments(args);
  const [command, ...rest] = positional;
  if (!command || options['help']) {
    io.out(usage);
    return command || options['help'] ? 0 : 1;
  }
  const folder = typeof options['folder'] === 'string' ? options['folder'] : (env['CADENCE_FOLDER'] ?? desktopFolder(env));
  // The MCP server runs wherever its client starts it: its files go to the documents folder, not there (CAD-122).
  const exportsFolder = typeof options['exports'] === 'string' ? options['exports'] : command === 'mcp' ? exportsDefault() : process.cwd();
  const to = typeof options['o'] === 'string' ? { to: options['o'] } : {};
  const credentials: RemoteCredentials | undefined =
    env['CADENCE_GIT_USERNAME'] || env['CADENCE_GIT_PASSWORD'] ? { username: env['CADENCE_GIT_USERNAME'] ?? '', password: env['CADENCE_GIT_PASSWORD'] ?? '' } : undefined;
  const open = (projects?: string) => {
    const { guide: _guide, sandbox: _sandbox, ...nodeHost } = host;
    const core = createNodeCore({ ...(projects ? { projects } : {}), exports: exportsFolder, ...nodeHost });
    return new Cadence(core, core.exports);
  };
  const need = (count: number) => {
    if (rest.length < count) throw new CadenceError('usage', `"${command}" needs ${count} argument${count > 1 ? 's' : ''}; see cadence --help.`);
  };

  try {
    switch (command) {
      case 'projects': {
        for (const p of await open(folder).projects.listProjects()) io.out(`${p.id}  ${p.name}  (${p.documentCount} documents)`);
        return 0;
      }
      case 'documents': {
        need(1);
        const cadence = open(folder);
        for (const d of await cadence.projects.listDocuments((await cadence.project(rest[0] as string)).id)) io.out(`${d.id}  ${d.kind.padEnd(9)}  ${d.name}`);
        return 0;
      }
      case 'export': {
        need(3);
        const cadence = open(folder);
        const document = await cadence.document(rest[1] as string, rest[0] as string);
        const format = (rest[2] as string).toLowerCase();
        if (document.kind === 'drawing' || document.kind === 'assembly') {
          const formats = document.kind === 'drawing' ? ['pdf', 'dxf'] : ['step', 'stl', 'obj', '3mf'];
          if (!formats.includes(format)) throw new CadenceError('usage', `A${document.kind === 'assembly' ? 'n' : ''} ${document.kind} exports to ${formats.join(', ')}.`);
          const script = document.kind === 'drawing' ? await cadence.drawing(document.id) : await cadence.assembly(document.id);
          io.out(await script.export(format as never, to));
          return 0;
        }
        if (document.kind !== 'component') throw new CadenceError('not-a-model', `${document.name} is not a component, an assembly or a drawing.`);
        const script = await cadence.component(document.id);
        let path: string;
        if (format === 'dxf' || format === 'svg') {
          if (options['flat-pattern']) path = await script.exportFlatPattern(format as DrawingFormat, to);
          else if (typeof options['sketch'] === 'string') path = await script.exportSketch(options['sketch'], format as DrawingFormat, to);
          else throw new CadenceError('usage', 'DXF and SVG need --sketch <id> or --flat-pattern.');
        } else path = await script.export(format as SolidFormat, to);
        io.out(path);
        return 0;
      }
      case 'picture': {
        need(3);
        const cadence = open(folder);
        const document = await cadence.document(rest[1] as string, rest[0] as string);
        const number = (key: string) => (typeof options[key] === 'string' ? Number(options[key]) : undefined);
        const width = number('width');
        const height = number('height');
        const text = (key: string) => (typeof options[key] === 'string' ? (options[key] as string) : undefined);
        const list = (key: string) => (text(key) ? { [key]: (text(key) as string).split(',') } : {});
        const vector = (key: string) => (text(key) ? { [key]: (text(key) as string).split(',').map(Number) as unknown as Vec3 } : {});
        const steps = number('steps');
        const time = number('time');
        const png = await cadence.picture(document.id, {
          ...(text('view') ? { view: text('view') as 'iso' } : {}),
          ...vector('direction'),
          ...vector('up'),
          ...(width ? { width } : {}),
          ...(height ? { height } : {}),
          ...(options['white'] ? { white: true } : {}),
          ...list('focus'),
          ...list('hide'),
          ...list('ghost'),
          ...(text('explode') ? { explode: text('explode') as string } : {}),
          ...(steps !== undefined ? { steps } : {}),
          ...(text('study') ? { study: text('study') as string } : {}),
          ...(time !== undefined ? { time } : {}),
        });
        await writeFile(rest[2] as string, png);
        io.out(rest[2] as string);
        return 0;
      }
      case 'convert': {
        need(2);
        const [input, output] = rest as [string, string];
        const cadence = open();
        const { project } = unwrap(await cadence.projects.createProject('Conversion'));
        const imported = unwrap(await cadence.projects.importFile(project.id, { name: basename(input), bytes: new Uint8Array(await readFile(input)) }));
        io.out(await cadence.exportImported(imported.id, formatOf(output) as ImportFormat, { to: output }));
        return 0;
      }
      case 'run': {
        need(1);
        const script = (await import(pathToFileURL(resolve(rest[0] as string)).href)) as { default?: (cadence: Cadence, args: readonly string[]) => unknown };
        if (typeof script.default !== 'function') throw new CadenceError('no-script', `${rest[0]} has no default export to run.`);
        const cadence = open(folder);
        await script.default(cadence, rest.slice(1));
        // Results still being written when the process ends would be left cut short (CAD-119).
        await cadence.settled();
        return 0;
      }
      case 'install-plugin': {
        need(2);
        const cadence = open(folder);
        const project = await cadence.project(rest[0] as string);
        const plugin = unwrap(await cadence.projects.installPlugin(project.id, await readFile(rest[1] as string, 'utf8')));
        io.out(`${plugin.id}  ${plugin.name} ${plugin.version}  (${[...plugin.features.map((f) => `feature ${f.name}`), ...plugin.generators.map((g) => `generator ${g.name}`), ...plugin.exporters.map((e) => `exporter ${e.name}`)].join(', ')})`);
        await cadence.settled();
        return 0;
      }
      case 'open-git': {
        need(1);
        const corsProxy = typeof options['cors-proxy'] === 'string' ? { corsProxy: options['cors-proxy'] } : {};
        const project = unwrap(await open(folder).projects.openRemoteProject({ url: rest[0] as string, ...corsProxy }, credentials));
        io.out(`${project.id}  ${project.name}  (${project.documentCount} documents)`);
        return 0;
      }
      case 'sync': {
        need(1);
        const cadence = open(folder);
        const outcome = unwrap(await cadence.projects.syncProject((await cadence.project(rest[0] as string)).id, credentials));
        if (outcome.kind === 'conflicts') {
          io.err(`Changed here and in the repository: ${outcome.conflicts.map((c) => c.name).join(', ')}. Resolve them in the app.`);
          return 2;
        }
        io.out(outcome.kind);
        return 0;
      }
      case 'mcp': {
        await serveStdio(new McpServer(open(folder), reference, version, exportsFolder, host.guide, host.sandbox));
        return 0;
      }
      default:
        io.err(`Unknown command "${command}".\n\n${usage}`);
        return 1;
    }
  } catch (error) {
    io.err(error instanceof CadenceError ? error.message : String((error as Error).stack ?? error));
    return 1;
  }
}
