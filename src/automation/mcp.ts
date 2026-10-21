import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import type { CreatableDocumentKind, DocumentId, ImportFormat, Parameter, ProjectId, Vec3 } from '@core/contracts';
import type { AssemblyCommand, AssemblyFormat } from '@core/managers/assembly';
import type { DrawingFormat, SolidFormat } from '@core/managers/design';
import { type AssemblyPictureOptions, type Cadence, CadenceError, type SummaryFilter, unwrap } from './api';
import type { ScriptCommand } from './shapes';
import { drawingTools } from './tools/drawings';
import { libraryTools } from './tools/libraries';
import { modelTools } from './tools/models';
import { projectTools } from './tools/projects';
import { scriptTools } from './tools/scripts';
import type { ScriptSandbox } from './script';
import { prompts, resourcesOf, type Resource } from './resources';
import { type Captioned, documentArg, runAll, number, object, point, type Progress, projectArg, string, strings, type Tool } from './tools/schema';

/** A JSON-RPC 2.0 message as MCP clients send it (newline-delimited JSON over stdio). */
export interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
}

const protocolVersions = ['2025-06-18', '2025-03-26', '2024-11-05'];

/** How an agent models with CADence; sent to the client when it connects. */
export const instructions = `CADence is a parametric CAD application. Projects hold components (parts), assemblies, technical drawings and imported files.
Model a part:
1. create_project, or list_projects and list_documents; a new project has an empty component ("Component 1"; rename_document renames it).
2. edit_component with commands, applied in order. Ids are yours to choose. Example, a 60 x 30 x 6 mm plate with a hole:
   [{"type":"create-sketch","id":"s1","plane":"XY"},
    {"type":"add-rectangle","sketchId":"s1","id":"r","x":0,"y":0,"width":60,"height":30},
    {"type":"add-circle","sketchId":"s1","id":"c","x":15,"y":15,"diameter":8}]
   It answers with what changed: new sketches with their profiles, timeline items with errors, and the bodies' face counts with new face names. Extrude a profile:
   [{"type":"add-feature","feature":{"type":"extrude","id":"e1","name":"","suppressed":false,"sketch":"s1","profiles":["<profile id>"],"distance":"6 mm","direction":"normal","operation":"new-body"}}]
3. get_component lists the component: parameters, timeline, sketches, and bodies with their faces (centre) and edges (middle). Filter it to keep answers small: only ["faces"], body, match "f:pocket:*", near [x,y,z]. Features such as fillet take {"kind":"edge","body":"<body id>","name":"<edge name>","hint":[x,y,z]}; the hint (its centre or middle) picks the right piece when a name is split (~1, ~2).
4. component_properties, check_component (print or laser rules) and export_component (STEP, STL, OBJ, 3MF; DXF or SVG of a sketch or a flat pattern).
5. render_picture shows a component or an assembly, to check what was made: from a view or a direction, zoomed onto chosen bodies or instances (focus), with others hidden or see-through (ghost).
6. Sketcher extras: a dimension with "reference": true measures without driving (get_component lists its value; with a "name", parameters and later features read it); make-block turns sketch geometry into a block sketch that {"kind":"block","block":"<sketch>","origin":"<point>","angle":"0 deg","scale":"1"} places again, in this or another component of the project ("document"); the feature "wrap" embosses or engraves profiles (text too) onto a cylinder, cone or any face.
Assemble:
1. create_document with kind "assembly", then edit_assembly with commands, e.g. [{"type":"insert-instance","instance":{"id":"base","component":"<component id>","name":"","transform":[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],"grounded":true}}]. Transforms are 4 x 4, column-major, mm (translation at 12, 13, 14).
2. A joint lays instance b's frame on instance a's: {"type":"add-joint","joint":{"id":"j1","name":"","type":"revolute","a":{"instance":"base","ref":{"kind":"face","body":"<body>","name":"<face>"}},"b":{"instance":"arm"},"flip":false,"values":[0],"limits":[null]}}.
   A side's frame: without ref, the component's origin (its XY plane, z up); on a flat face, its centre and outward normal; on a round face or a circular edge, its axis. "offset":{"translate":[x,y,z],"lean":degrees,"tilt":degrees,"angle":degrees} moves a frame along its own axes, turns it about its z (lean), tilts it about its new x (lean and tilt point a joint along any direction no face has), then turns it about its new z. flip turns b over (its z against a's). values move b along or about the frame's z, in mm or degrees, in the order of jointDofs (revolute: angle; slider: distance; cylindrical: angle, distance).
3. get_assembly lists instances (where they are), joints (with why they fail), links, patterns, motion studies and exploded views. set-link makes one joint drive another (gears, bevel gears, worms, planetary sets; a cam with a profile of [angle, lift] pairs moves its follower), set-pattern copies instances, add-study keys or drives joints over time, set-exploded-view takes the assembly apart (steps may name pattern copies, "<pattern>/<instance>/<n>", and "radial": true moves each part away from the axis along the direction).
4. render_picture with explode (and steps) or study and time shows it apart or moving; animate_study writes a GIF and shows a sheet of moments; check_assembly finds overlaps and collisions (with "seconds" to limit a long study check); assembly_properties gives the mass and the bill of materials.
Draw:
1. create_document with kind "drawing" (an A3 sheet at 1:1), then edit_drawing: set-sheet (size, orientation, scale), set-title-block, add-view {"id":"front","source":"<component or assembly id>","direction":"front","at":[x,y]} (front, back, top, bottom, left, right, iso; section (full, offset or half), detail, scale, label). Sheet coordinates are mm from the bottom left.
2. get_drawing lists the views' boxes on the sheet and their anchors: points, circles and lines by persistent name, where they are on the sheet. Annotations attach to anchors: dimensions (linear, horizontal, vertical, radius, diameter, angle; with tolerances and ISO fits), center marks and lines, hole and thread callouts, surface finish symbols; notes, balloons and parts lists sit at sheet points.
3. render_picture of a drawing shows the sheet as the PDF prints it (focus [view id] zooms onto a view); export_drawing writes PDF or DXF.
Lengths are expressions ("6 mm", "2 * wall", "1 in"); plain numbers are millimetres. command_reference has every command, feature, part, assembly and drawing type as TypeScript, by topic (commands, sketch, features, document, assembly, drawing); the same and the user guide are resources (cadence://reference/<topic>, cadence://guide/<page>).
Many steps at once: run_script runs a whole script against the scripting API (loops, calculations, many parts or sheets) in a sandbox, and answers with what it returned, printed and changed (cadence://reference/scripts).`;

/** The MCP server: CADence's scripting API as tools (docs/User-guide/Automation.md). */
export class McpServer {
  private readonly tools: readonly Tool[];

  constructor(
    private readonly cadence: Cadence,
    /** The command and feature types by topic, for `command_reference`. */
    private readonly reference: Readonly<Record<string, string>>,
    private readonly version: string,
    /** Where files go when a tool is given no path, for the agent to know. */
    private readonly exportsFolder?: string,
    /** The user guide's pages by name, as resources (CAD-172). */
    guide: Readonly<Record<string, string>> = {},
    /** Runs scripts (run_script): a worker of their own in the command line; this thread in tests. */
    private readonly sandbox?: ScriptSandbox,
  ) {
    this.tools = this.createTools();
    this.resources = resourcesOf(reference, guide);
  }

  private readonly resources: readonly Resource[];

  /** Tool calls in progress, by request id: whether they were cancelled, and how to stop them. */
  private readonly running = new Map<string | number, { cancelled: boolean; readonly stop: AbortController }>();

  /**
   * The response to a message; undefined for notifications, and for a request cancelled meanwhile.
   * `notify` sends notifications (progress) meanwhile. Requests may be handled side by side.
   */
  async handle(message: JsonRpcMessage, notify: (notification: Record<string, unknown>) => void = () => undefined): Promise<Record<string, unknown> | undefined> {
    const { id, method, params = {} } = message;
    // A cancelled tool call stops the geometry kernel's computation, where it can be stopped (CAD-134).
    if (method === 'notifications/cancelled') {
      const call = this.running.get(params['requestId'] as string | number);
      if (call && !call.cancelled) {
        call.cancelled = true;
        call.stop.abort();
        this.cadence.stop();
      }
      return undefined;
    }
    if (id === undefined || id === null) return undefined;
    const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize': {
        const requested = String(params['protocolVersion'] ?? '');
        return reply({
          protocolVersion: protocolVersions.includes(requested) ? requested : protocolVersions[0],
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'cadence', version: this.version },
          instructions: this.exportsFolder ? `${instructions}
Files (exports, animations) go to ${this.exportsFolder} unless a tool is given a path.` : instructions,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: this.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'resources/list':
        return reply({ resources: this.resources.map(({ text, ...resource }) => ({ ...resource, size: text.length })) });
      case 'resources/templates/list':
        return reply({ resourceTemplates: [] });
      case 'resources/read': {
        const resource = this.resources.find((r) => r.uri === params['uri']);
        if (!resource) return { jsonrpc: '2.0', id, error: { code: -32002, message: `No resource ${String(params['uri'])}.`, data: { uri: params['uri'] } } };
        return reply({ contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] });
      }
      case 'prompts/list':
        return reply({ prompts: prompts.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) });
      case 'prompts/get': {
        const prompt = prompts.find((p) => p.name === params['name']);
        if (!prompt) return { jsonrpc: '2.0', id, error: { code: -32602, message: `No prompt ${String(params['name'])}. Prompts: ${prompts.map((p) => p.name).join(', ')}.` } };
        const args = (params['arguments'] ?? {}) as Record<string, string>;
        const missing = prompt.arguments.filter((a) => a.required && !args[a.name]?.trim()).map((a) => a.name);
        if (missing.length) return { jsonrpc: '2.0', id, error: { code: -32602, message: `The prompt ${prompt.name} needs ${missing.join(', ')}.` } };
        return reply({ description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args) } }] });
      }
      case 'tools/call': {
        const token = (params['_meta'] as { progressToken?: string | number } | undefined)?.progressToken;
        const progress: Progress = (done, total, text) => {
          if (token !== undefined) notify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: done, total, message: text } });
        };
        const call = { cancelled: false, stop: new AbortController() };
        this.running.set(id, call);
        try {
          const answer = await this.call(String(params['name']), (params['arguments'] ?? {}) as Record<string, unknown>, progress, call.stop.signal);
          return call.cancelled ? undefined : reply(answer);
        } finally {
          this.running.delete(id);
        }
      }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } };
    }
  }

  private async call(name: string, args: Record<string, unknown>, progress: Progress, signal: AbortSignal): Promise<Record<string, unknown>> {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) return { content: [{ type: 'text', text: `Unknown tool ${name}.` }], isError: true };
    await this.cadence.kernelRestarted();
    const answer = await this.answer(tool, args, progress, signal);
    // A kernel that failed during the call (out of memory) has started again: say so (CAD-133).
    if (!(await this.cadence.kernelRestarted())) return answer;
    const note = 'The geometry kernel failed during this call and started again; documents open here are read again from their files. Unsaved results are lost; saved documents are not.';
    return { ...answer, content: [...(answer['content'] as unknown[]), { type: 'text', text: note }] };
  }

  private async answer(tool: Tool, args: Record<string, unknown>, progress: Progress, signal: AbortSignal): Promise<Record<string, unknown>> {
    const image = (bytes: Uint8Array) => ({ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' });
    try {
      const result = await tool.run(args, progress, signal);
      // Pictures go back as images the agent can look at.
      if (result instanceof Uint8Array) return { content: [image(result)] };
      if (result && typeof result === 'object' && 'picture' in result) {
        const { picture, caption } = result as Captioned;
        return { content: [image(picture), { type: 'text', text: caption }] };
      }
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
    const assembly = async (args: Record<string, unknown>) => {
      const document = await cadence.document(String(args['document']));
      if (document.kind !== 'assembly') throw new CadenceError('not-an-assembly', `${document.name} is not an assembly.`);
      return cadence.assembly(document.id);
    };
    const pictureArgs = {
      view: { type: 'string', enum: ['iso', 'front', 'back', 'top', 'bottom', 'left', 'right'] },
      direction: point('A free camera instead of a view: from the model towards the camera, e.g. [1, -2, 1].'),
      up: point('With direction: which way is up in the picture (default [0, 0, 1]).'),
      width: number('Pixels, 800 by default.'),
      height: number('Pixels, 600 by default.'),
      focus: strings('Body ids (of a component) or instance ids (of an assembly) to zoom onto.'),
      hide: strings('Body or instance ids to leave out.'),
      ghost: strings('Body or instance ids to show see-through.'),
      section: object({ point: point('A point of the plane.'), normal: point('Its normal: what lies on this side is taken away.') }, ['point', 'normal']),
    };
    const pictureOptions = (args: Record<string, unknown>): AssemblyPictureOptions => {
      const list = (key: string) => (Array.isArray(args[key]) ? { [key]: (args[key] as unknown[]).map(String) } : {});
      const vector = (key: string) => (Array.isArray(args[key]) ? { [key]: (args[key] as unknown[]).map(Number) as unknown as Vec3 } : {});
      return {
        ...(args['view'] ? { view: args['view'] as 'iso' } : {}),
        ...vector('direction'),
        ...vector('up'),
        ...(args['width'] ? { width: Number(args['width']) } : {}),
        ...(args['height'] ? { height: Number(args['height']) } : {}),
        ...list('focus'),
        ...list('hide'),
        ...list('ghost'),
        ...(args['section'] ? { section: args['section'] as { point: Vec3; normal: Vec3 } } : {}),
        ...(args['explode'] !== undefined ? { explode: String(args['explode']) } : {}),
        ...(args['steps'] !== undefined ? { steps: Number(args['steps']) } : {}),
        ...(args['study'] !== undefined ? { study: String(args['study']) } : {}),
        ...(args['time'] !== undefined ? { time: Number(args['time']) } : {}),
        white: true,
      };
    };
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
        description: 'Adds an empty component, assembly or drawing to a project.',
        inputSchema: object({ project: projectArg, kind: { type: 'string', enum: ['component', 'assembly', 'drawing'] }, name: string('Optional name.') }, ['project', 'kind']),
        run: async (args) => {
          const name = args['name'] === undefined ? undefined : String(args['name']);
          const created = unwrap(await cadence.projects.createDocument(await projectId(args), args['kind'] as CreatableDocumentKind, name));
          return { id: created.id, name: created.name, kind: created.kind };
        },
      },
      {
        name: 'rename_document',
        description: 'Renames a component, an assembly or an imported file.',
        inputSchema: object({ document: documentArg, name: string('The new name.') }, ['document', 'name']),
        run: async (args) => {
          const document = await cadence.document(String(args['document']));
          unwrap(await cadence.projects.renameDocument(document.id, String(args['name'])));
          cadence.forget(document.id);
          return `Renamed to ${String(args['name'])}.`;
        },
      },
      {
        name: 'delete_document',
        description: 'Moves a component, an assembly, a drawing or an imported file to the trash, where it stays for 30 days with its history (trash restores it).',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => {
          const document = await cadence.document(String(args['document']));
          cadence.forget(document.id);
          await cadence.projects.deleteDocument(document.id as DocumentId);
          return `Moved ${document.name} to the trash (restore it with trash).`;
        },
      },
      {
        name: 'import_file',
        description:
          'Imports a file (STEP, STL, OBJ, 3MF, KiCad board, DXF, SVG, PNG, JPEG) from disk into a project; with replace, puts it in place of an imported document (instances and sketches that use it follow). A KiCad board (.kicad_pcb) answers with its holes, whose walls are named for joints (hole:<reference>); with triangles, a mesh is also kept repaired and simplified to about that many triangles, so it can be used as a solid.',
        inputSchema: object(
          {
            project: projectArg,
            path: string('Path of the file on this computer.'),
            replace: string('An imported document to replace (id).'),
            triangles: number('For a mesh (STL, OBJ, 3MF): also keep a copy, repaired and simplified to about this many triangles (up to 100,000 become solids).'),
          },
          ['project', 'path'],
        ),
        run: async (args) => {
          const path = String(args['path']);
          if (args['replace'] !== undefined) {
            const document = await cadence.document(String(args['replace']));
            unwrap(await cadence.projects.replaceImported(document.id, { name: basename(path), bytes: new Uint8Array(await readFile(path)) }));
            cadence.forget();
            return `Replaced ${document.name}.`;
          }
          const imported = unwrap(await cadence.projects.importFile(await projectId(args), { name: basename(path), bytes: new Uint8Array(await readFile(path)) }));
          const answer: Record<string, unknown> = { id: imported.id, name: imported.name, kind: imported.kind };
          if (imported.format === 'kicad_pcb') {
            const content = unwrap(await cadence.projects.previewImported(imported.id));
            if (content.kind === 'model' && content.board) answer['board'] = content.board;
          }
          if (args['triangles'] !== undefined) {
            const preview = unwrap(await cadence.projects.previewSimplified(imported.id, Number(args['triangles'])));
            const simplified = unwrap(await cadence.projects.simplifyImported(imported.id, Number(args['triangles'])));
            answer['simplified'] = { id: simplified.id, name: simplified.name, triangles: preview.content.triangles, of: preview.before, repair: preview.repair };
          }
          return answer;
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
        description:
          'A component as data: parameters, timeline with errors, sketches with their profiles, bodies with their faces (and centres) and edges (and middles). Filters keep it short: only some parts, one sketch or body, names matching a pattern, or near a point.',
        inputSchema: object(
          {
            document: documentArg,
            only: { type: 'array', items: { type: 'string', enum: ['parameters', 'timeline', 'sketches', 'faces', 'edges'] }, description: 'List only these parts.' },
            sketch: string('Only this sketch.'),
            body: string('Only this body.'),
            match: string('Only faces and edges whose names match, * for any text: "f:pocket:*".'),
            near: point('Only faces and edges within `within` mm of this point.'),
            within: number('Distance for near, mm (5 by default).'),
          },
          ['document'],
        ),
        run: async (args) => {
          const { document: _, ...filter } = args;
          return (await component(args)).summary(filter as SummaryFilter);
        },
      },
      {
        name: 'edit_component',
        description:
          'Runs commands on a component in order (see the server instructions and command_reference), then answers with what changed: timeline items, sketches and their profiles, bodies with face counts and new face names. Stops at the first refused command; the ones before it stay applied.',
        inputSchema: object({ document: documentArg, commands: { type: 'array', items: { type: 'object' }, description: 'Design commands, e.g. {"type":"create-sketch","id":"s1","plane":"XY"}.' } }, ['document', 'commands']),
        run: async (args) => {
          const script = await component(args);
          const before = script.summary({ only: ['parameters', 'timeline', 'sketches', 'faces'] });
          await runAll(args['commands'] as ScriptCommand[], (command) => script.run(command));
          return script.changes(before);
        },
      },
      {
        name: 'undo_component',
        description: 'Undoes the last change of a component (or redoes it, with redo); answers with what changed.',
        inputSchema: object({ document: documentArg, redo: { type: 'boolean', description: 'Redo instead.' } }, ['document']),
        run: async (args) => {
          const script = await component(args);
          const before = script.summary({ only: ['parameters', 'timeline', 'sketches', 'faces'] });
          await (args['redo'] ? script.redo() : script.undo());
          return script.changes(before);
        },
      },
      {
        name: 'component_properties',
        description: 'Volume (mm³), surface area (mm²), mass (g, from the material), centre of mass and bounding box of each body; a spring part made as a body has its rate (N/mm, a torsion spring N·mm/°) and lengths.',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => (await component(args)).properties(),
      },
      {
        name: 'check_component',
        description: 'Checks a component against its manufacturing profile (3D printing or laser cutting; set with the set-process command).',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => (await component(args)).validate(),
      },
      {
        name: 'export_component',
        description:
          'Writes a component to a file: its bodies as STEP, STL, OBJ or 3MF; a sketch, or the flat pattern of a sheet metal part, as DXF or SVG; html: a viewer for people without CADence; glb (glTF) or usdz: for other viewers and augmented reality, in metres; csv: the configuration table; plugin: with a plugin exporter of its project (exporter "<plugin id>/<exporter>", list_scripts). Returns the path.',
        inputSchema: object(
          {
            document: documentArg,
            format: { type: 'string', enum: ['step', 'stl', 'obj', '3mf', 'dxf', 'svg', 'html', 'glb', 'usdz', 'csv', 'plugin'] },
            exporter: string('For plugin: "<plugin id>/<exporter>".'),
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
          if (format === 'html' || format === 'glb' || format === 'usdz') return script.exportViewer({ ...to, format });
          if (format === 'csv') return script.exportConfigurations(to);
          if (format === 'plugin') {
            const exporter = String(args['exporter'] ?? '');
            const slash = exporter.lastIndexOf('/');
            if (slash <= 0) throw new CadenceError('usage', 'A plugin export needs exporter "<plugin id>/<exporter>" (list_scripts lists them).');
            return script.exportWith(exporter.slice(0, slash), exporter.slice(slash + 1), to);
          }
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
        name: 'get_assembly',
        description: 'An assembly as data: its components, instances (with their transforms and origins), pattern copies, joints (with why they fail), motion links, patterns, motion studies and exploded views.',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => (await assembly(args)).summary(),
      },
      {
        name: 'edit_assembly',
        description:
          'Runs assembly commands in order (insert-instance, add-joint, set-joint-values, set-link, set-pattern, add-study, set-exploded-view and the others in command_reference), then answers with what changed and which joints fail. Stops at the first refused command; the ones before it stay applied.',
        inputSchema: object({ document: documentArg, commands: { type: 'array', items: { type: 'object' }, description: 'Assembly commands, e.g. {"type":"ground-instance","instanceId":"base","grounded":true}.' } }, ['document', 'commands']),
        run: async (args) => {
          const script = await assembly(args);
          const before = await script.summary();
          await runAll(args['commands'] as AssemblyCommand[], (command) => script.run(command));
          return script.changes(before);
        },
      },
      {
        name: 'undo_assembly',
        description: 'Undoes the last change of an assembly (or redoes it, with redo); answers with what changed.',
        inputSchema: object({ document: documentArg, redo: { type: 'boolean', description: 'Redo instead.' } }, ['document']),
        run: async (args) => {
          const script = await assembly(args);
          const before = await script.summary();
          await (args['redo'] ? script.redo() : script.undo());
          return script.changes(before);
        },
      },
      {
        name: 'check_assembly',
        description:
          'Instances whose solids overlap where they are now (with the volume, mm³); with a motion study, where instances and pattern copies hit while it plays (the first moment of each pair), with progress notifications and an optional time limit.',
        inputSchema: object(
          {
            document: documentArg,
            study: string('A motion study id, to check it for collisions.'),
            fps: number('Moments checked per second of the study (10 by default).'),
            seconds: number('Stop after this long and report the moments checked so far.'),
          },
          ['document'],
        ),
        run: async (args, progress) => {
          const script = await assembly(args);
          if (args['study'] === undefined) return script.interference({ onProgress: (done, total) => progress(done, total, `Part ${done} of ${total} checked`) });
          return script.collisions(String(args['study']), args['fps'] === undefined ? undefined : Number(args['fps']), {
            onProgress: (done, total) => progress(done, total, `Moment ${done} of ${total} checked`),
            ...(args['seconds'] !== undefined ? { seconds: Number(args['seconds']) } : {}),
          });
        },
      },
      {
        name: 'assembly_properties',
        description: 'The mass (g), volume (mm³) and centre of mass of an assembly, the mass of each part, and the bill of materials (components, counts, materials).',
        inputSchema: object({ document: documentArg }, ['document']),
        run: async (args) => {
          const script = await assembly(args);
          return { ...(await script.properties()), billOfMaterials: await script.billOfMaterials() };
        },
      },
      {
        name: 'export_assembly',
        description:
          'Writes an assembly to a file: STEP (one named solid per instance), 3MF, STL or OBJ; csv: the bill of materials; html: a viewer for people without CADence (turn, measure, hide, explode); glb (glTF) or usdz: for other viewers and augmented reality, in metres; pdf: build instructions from an exploded view (explode), the parts list and a page per step. Returns the path.',
        inputSchema: object(
          {
            document: documentArg,
            format: { type: 'string', enum: ['step', '3mf', 'stl', 'obj', 'csv', 'html', 'glb', 'usdz', 'pdf'] },
            explode: string('For pdf: the exploded view whose steps the instructions follow.'),
            path: string('Where to write the file (default: the exports folder).'),
          },
          ['document', 'format'],
        ),
        run: async (args) => {
          const script = await assembly(args);
          const to = args['path'] === undefined ? {} : { to: String(args['path']) };
          const format = String(args['format']);
          if (format === 'csv') return script.exportBillOfMaterials(to);
          if (format === 'html' || format === 'glb' || format === 'usdz') return script.exportViewer({ ...to, format });
          if (format === 'pdf') {
            if (args['explode'] === undefined) throw new CadenceError('usage', 'Build instructions follow an exploded view: give its id as explode.');
            return script.exportInstructions(String(args['explode']), to);
          }
          return script.export(format as AssemblyFormat, to);
        },
      },
      {
        name: 'render_picture',
        description:
          'A picture (PNG) of a component or an assembly, to look at what was made: from a view (isometric by default) or a free direction, zoomed onto bodies or instances, with others hidden or see-through. Assemblies also exploded (an exploded view, all or the first steps) or at a moment of a motion study. A section plane cuts the model open, as the section view of the app does. A drawing shows its sheet as the PDF prints it (width only; focus one view id to zoom onto it); an imported 3D file shows as it was read.',
        inputSchema: object(
          {
            document: string('Component, assembly, drawing or imported file id (from list_documents).'),
            ...pictureArgs,
            explode: string('Assemblies: an exploded view id, shown apart.'),
            steps: number('With explode: how many of its steps (all by default).'),
            study: string('Assemblies: a motion study id.'),
            time: number('With study: the moment, in seconds (0 by default).'),
          },
          ['document'],
        ),
        run: (args) => cadence.picture(String(args['document']), pictureOptions(args)),
      },
      {
        name: 'animate_study',
        description: 'Plays a motion study of an assembly into an animated GIF (written to the exports folder; returns its path) and shows a sheet of moments of it, left to right and top to bottom.',
        inputSchema: object({ document: string('Assembly id.'), study: string('Motion study id.'), ...pictureArgs, fps: number('Frames per second of the GIF (10 by default).'), moments: number('Pictures on the sheet (9 by default, at most 16).'), path: string('Where to write the GIF.') }, [
          'document',
          'study',
        ]),
        run: async (args) => {
          const script = await assembly(args);
          const { white: _, ...options } = pictureOptions(args);
          const result = await script.animation(String(args['study']), {
            ...options,
            ...(args['fps'] !== undefined ? { fps: Number(args['fps']) } : {}),
            ...(args['moments'] !== undefined ? { moments: Number(args['moments']) } : {}),
            ...(args['path'] !== undefined ? { to: String(args['path']) } : {}),
          });
          const asked = Math.max(1, Math.min(16, args['moments'] === undefined ? 9 : Number(args['moments'])));
          const repeats = result.times.length < asked ? ` The study repeats itself: only ${result.times.length} moments show different poses.` : '';
          return { picture: result.sheet, caption: `The animation is at ${result.path}. The sheet shows the moments ${result.times.join(', ')} s.${repeats}` } satisfies Captioned;
        },
      },
      {
        name: 'command_reference',
        description:
          'The TypeScript types of the commands and contracts, with their documentation, by topic: commands (design commands and shorthands), sketch (entities and constraints), features (features and parts: gears, ring gears, screws, bearings …), document (components, materials, checks, appearance), assembly (assembly commands, instances, joints, links, studies, exploded views), drawing (drawing commands, sheets, views, annotations). Without a topic, the list of topics.',
        inputSchema: object({ topic: { type: 'string', enum: Object.keys(this.reference) } }),
        run: async (args) => {
          const topic = args['topic'] === undefined ? undefined : String(args['topic']);
          if (topic === undefined) return `Topics: ${Object.entries(this.reference).map(([name, text]) => `${name} (${Math.round(text.length / 1000)}k characters)`).join(', ')}. Ask for one with {"topic": "<name>"}.`;
          const text = this.reference[topic];
          if (text === undefined) throw new CadenceError('usage', `No topic "${topic}". Topics: ${Object.keys(this.reference).join(', ')}.`);
          return text;
        },
      },
      ...drawingTools(cadence),
      ...modelTools(cadence),
      ...projectTools(cadence),
      ...libraryTools(cadence),
      ...scriptTools(cadence, this.exportsFolder, this.sandbox),
    ];
  }
}

/** Serves MCP over stdio: one JSON-RPC message per line in, one per line out; nothing else goes to stdout. */
export function serveStdio(server: McpServer, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity });
  // Side by side, not one after another: a long computation holds up no other request (CAD-134).
  const handling = new Set<Promise<void>>();
  lines.on('line', (line) => {
    if (!line.trim()) return;
    const work = (async () => {
      let message: JsonRpcMessage;
      try {
        message = JSON.parse(line) as JsonRpcMessage;
      } catch {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
        return;
      }
      const notify = (notification: Record<string, unknown>) => output.write(`${JSON.stringify(notification)}\n`);
      const response = await server.handle(message, notify).catch((error: Error) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: error.message } }));
      if (response) output.write(`${JSON.stringify(response)}\n`);
    })();
    handling.add(work);
    void work.finally(() => handling.delete(work));
  });
  return new Promise((resolve) => lines.on('close', () => void Promise.all(handling).then(() => resolve())));
}
