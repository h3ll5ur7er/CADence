import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import type { CreatableDocumentKind, ImportFormat, Parameter, ProjectId } from '@core/contracts';
import type { DrawingFormat, SolidFormat } from '@core/managers/design';
import { type Cadence, CadenceError, unwrap } from './api';
import type { ScriptCommand } from './shapes';

/** A JSON-RPC 2.0 message as MCP clients send it (newline-delimited JSON over stdio). */
export interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>): Promise<unknown>;
}

const protocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05'];

const string = (description: string) => ({ type: 'string', description });
const object = (properties: Record<string, unknown>, required: readonly string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const projectArg = string('Project id or name (list_projects).');
const documentArg = string('Document id (list_documents).');

/** How an agent models with CADence; sent to the client when it connects. */
export const instructions = `CADence is a parametric CAD application. Projects hold components (parts), assemblies and imported files.
Model a part:
1. create_project, or list_projects and list_documents; a new project has an empty component ("Component 1").
2. edit_component with commands, applied in order. Ids are yours to choose. Example, a 60 x 30 x 6 mm plate with a hole:
   [{"type":"create-sketch","id":"s1","plane":"XY"},
    {"type":"add-rectangle","sketchId":"s1","id":"r","x":0,"y":0,"width":60,"height":30},
    {"type":"add-circle","sketchId":"s1","id":"c","x":15,"y":15,"diameter":8}]
   then get_component to read the sketch's profiles, and extrude one:
   [{"type":"add-feature","feature":{"type":"extrude","id":"e1","name":"","suppressed":false,"sketch":"s1","profiles":["<profile id>"],"distance":"6 mm","direction":"normal","operation":"new-body"}}]
3. get_component lists the timeline (with errors), sketches with their profiles, and bodies with their face and edge names, which features such as fillet take as {"kind":"edge","body":"<body id>","name":"<edge name>"}.
4. component_properties, check_component (print or laser rules) and export_component (STEP, STL, OBJ, 3MF; DXF or SVG of a sketch or a flat pattern).
Lengths are expressions ("6 mm", "2 * wall", "1 in"); plain numbers are millimetres. command_reference has every command and feature as TypeScript types.`;

/** The MCP server: CADence's scripting API as tools (docs/User-guide/Automation.md). */
export class McpServer {
  private readonly tools: readonly Tool[];

  constructor(
    private readonly cadence: Cadence,
    /** The command and feature types, for `command_reference`. */
    private readonly reference: string,
    private readonly version: string,
  ) {
    this.tools = this.createTools();
  }

  /** The response to a message; undefined for notifications. */
  async handle(message: JsonRpcMessage): Promise<Record<string, unknown> | undefined> {
    const { id, method, params = {} } = message;
    if (id === undefined || id === null) return undefined;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize': {
        const requested = String(params['protocolVersion'] ?? '');
        return reply({
          protocolVersion: protocolVersions.includes(requested) ? requested : protocolVersions[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'cadence', version: this.version },
          instructions,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call':
        return reply(await this.call(String(params['name']), (params['arguments'] ?? {}) as Record<string, unknown>));
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } };
    }
  }

  private async call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool ${name}.` }], isError: true };
    try {
      const result = await tool.run(args);
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof CadenceError ? `${error.message} (${error.code})` : String((error as Error).message ?? error);
      return { content: [{ type: 'text', text: message }], isError: true };
    }
  }

  private createTools(): Tool[] {
    const cadence = this.cadence;
    const projectId = async (args: Record<string, unknown>) => (await cadence.project(String(args['project']))).id;
    const component = (args: Record<string, unknown>) => cadence.component(String(args['document']));
    return [
      {
        name: 'list_projects',
        description: 'Lists the projects, most recently changed first.',
        inputSchema: object({}),
        run: async () => (await cadence.projects.listProjects()).map(({ id, name, documentCount, modifiedAt }) => ({ id, name, documentCount, modifiedAt })),
      },
      {
        name: 'create_project',
        description: 'Creates a project with an empty component to model in.',
        inputSchema: object({ name: string('Project name.') }, ['name']),
        run: async (args) => {
          const { project, firstDocument } = unwrap(await cadence.projects.createProject(String(args['name'])));
          return { project: { id: project.id, name: project.name }, component: { id: firstDocument.id, name: firstDocument.name } };
        },
      },
      {
        name: 'list_documents',
        description: "Lists a project's components, assemblies and imported files.",
        inputSchema: object({ project: projectArg }, ['project']),
        run: async (args) => (await cadence.projects.listDocuments(await projectId(args))).map(({ id, name, kind }) => ({ id, name, kind })),
      },
      {
        name: 'create_document',
        description: 'Adds an empty component or assembly to a project.',
        inputSchema: object({ project: projectArg, kind: { type: 'string', enum: ['component', 'assembly'] }, name: string('Optional name.') }, ['project', 'kind']),
        run: async (args) => {
          const name = args['name'] === undefined ? undefined : String(args['name']);
          const created = unwrap(await cadence.projects.createDocument(await projectId(args), args['kind'] as CreatableDocumentKind, name));
          return { id: created.id, name: created.name, kind: created.kind };
        },
      },
      {
        name: 'import_file',
        description: 'Imports a file (STEP, STL, OBJ, 3MF, DXF, SVG) from disk into a project.',
        inputSchema: object({ project: projectArg, path: string('Path of the file on this computer.') }, ['project', 'path']),
        run: async (args) => {
          const path = String(args['path']);
          const imported = unwrap(await cadence.projects.importFile(await projectId(args), { name: basename(path), bytes: new Uint8Array(await readFile(path)) }));
          return { id: imported.id, name: imported.name, kind: imported.kind };
        },
      },
      {
        name: 'set_project_parameters',
        description: 'Replaces the parameters every component of the project can use (e.g. wall = "3 mm").',
        inputSchema: object(
          { project: projectArg, parameters: { type: 'array', items: object({ name: string('Parameter name.'), expression: string('Value, e.g. "3 mm" or "wall * 2".') }, ['name', 'expression']) } },
          ['project', 'parameters'],
        ),
        run: async (args) => {
          const parameters = (args['parameters'] as { name: string; expression: string }[]).map((p, i): Parameter => ({ id: `p${i + 1}`, name: p.name, expression: p.expression }));
          unwrap(await cadence.projects.setProjectParameters((await projectId(args)) as ProjectId, parameters));
          return 'Parameters set.';
        },
      },
      {
        name: 'get_component',
        description: 'A component as data: parameters, timeline with errors, sketches with their profiles, bodies with face and edge names.',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => (await component(args)).summary(),
      },
      {
        name: 'edit_component',
        description:
          'Runs commands on a component in order (see the server instructions and command_reference), then returns the component. Stops at the first refused command; the ones before it stay applied.',
        inputSchema: object({ document: documentArg, commands: { type: 'array', items: { type: 'object' }, description: 'Design commands, e.g. {"type":"create-sketch","id":"s1","plane":"XY"}.' } }, ['document', 'commands']),
        run: async (args) => {
          const script = await component(args);
          const commands = args['commands'] as ScriptCommand[];
          for (const [index, command] of commands.entries()) {
            try {
              await script.run(command);
            } catch (error) {
              if (!(error instanceof CadenceError)) throw error;
              throw new CadenceError(error.code, `Command ${index + 1} (${command.type}) was refused: ${error.message}`);
            }
          }
          return script.summary();
        },
      },
      {
        name: 'undo_component',
        description: 'Undoes the last change of a component.',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => {
          const script = await component(args);
          await script.undo();
          return script.summary();
        },
      },
      {
        name: 'component_properties',
        description: 'Volume (mm³), surface area (mm²), mass (g, from the material), centre of mass and bounding box of each body.',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => (await component(args)).properties(),
      },
      {
        name: 'check_component',
        description: "Checks a component against its manufacturing profile (3D printing or laser cutting; set with the set-process command).",
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => (await component(args)).validate(),
      },
      {
        name: 'export_component',
        description: 'Writes a component to a file: its bodies as STEP, STL, OBJ or 3MF; a sketch, or the flat pattern of a sheet metal part, as DXF or SVG. Returns the path.',
        inputSchema: object(
          {
            document: documentArg,
            format: { type: 'string', enum: ['step', 'stl', 'obj', '3mf', 'dxf', 'svg'] },
            sketch: string('For DXF and SVG: the sketch id.'),
            flatPattern: { type: 'boolean', description: 'For DXF and SVG: the flat pattern instead of a sketch.' },
            path: string('Where to write the file (default: the exports folder).'),
          },
          ['document', 'format'],
        ),
        run: async (args) => {
          const script = await component(args);
          const format = String(args['format']);
          const to = args['path'] === undefined ? {} : { to: String(args['path']) };
          if (format !== 'dxf' && format !== 'svg') return script.export(format as SolidFormat, to);
          if (args['flatPattern']) return script.exportFlatPattern(format as DrawingFormat, to);
          if (!args['sketch']) throw new CadenceError('no-sketch', 'DXF and SVG need a sketch id or flatPattern.');
          return script.exportSketch(String(args['sketch']), format as DrawingFormat, to);
        },
      },
      {
        name: 'export_imported',
        description: 'Writes an imported file in another format (3D files to STEP, STL, OBJ or 3MF; drawings to DXF or SVG). Returns the path.',
        inputSchema: object({ document: documentArg, format: { type: 'string', enum: ['step', 'stl', 'obj', '3mf', 'dxf', 'svg'] }, path: string('Where to write the file.') }, ['document', 'format']),
        run: async (args) => cadence.exportImported(String(args['document']), args['format'] as ImportFormat, args['path'] === undefined ? {} : { to: String(args['path']) }),
      },
      {
        name: 'command_reference',
        description: 'The TypeScript types of every design command, feature, sketch entity and constraint, with their documentation.',
        inputSchema: object({}),
        run: async () => this.reference,
      },
    ];
  }
}

/** Serves MCP over stdio: one JSON-RPC message per line in, one per line out; nothing else goes to stdout. */
export function serveStdio(server: McpServer, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  let queue: Promise<unknown> = Promise.resolve();
  lines.on('line', (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        return;
      }
      const response = await server.handle(message).catch((error: Error) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: error.message } }));
      if (response) output.write(`${JSON.stringify(response)}\n`);
    });
  });
  return new Promise((resolve) => lines.on('close', () => void queue.then(() => resolve())));
}
