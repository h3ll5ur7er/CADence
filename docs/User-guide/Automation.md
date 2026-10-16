# Automation

Model, check, convert and export without the app: with scripts, on the command line, or by an AI agent through the Model Context Protocol (MCP). All three work on project folders, the way the desktop app keeps projects, and use the same geometry kernel as the app.

[TOC]

## Set up

The command line runs from a copy of this repository (Node 24):

```bash
npm install
npm run build:automation
```

That builds `dist/automation/cadence.mjs`. Run it with `npm run cadence -- <command>` or `node dist/automation/cadence.mjs <command>`; `--help` lists the commands.

**Which projects.** By default, the command line works on the desktop app's projects (`%APPDATA%\dev.cadence.app` on Windows, `~/Library/Application Support/dev.cadence.app` on macOS, `~/.local/share/dev.cadence.app` on Linux). `--folder <dir>` or the environment variable `CADENCE_FOLDER` picks another folder. Projects in a browser are not reachable from the command line: sync them through git ([[User-guide/Projects-and-versions#Sync with git]]) and use `open-git`.

> [!WARNING]
> Do not change the same document in the desktop app and from the command line at the same time: the app does not notice changes made outside it until the document is opened again.

## Command line

| Command | What it does |
| --- | --- |
| `projects` | Lists the projects |
| `documents <project>` | Lists a project's documents |
| `export <project> <document> <format>` | Exports a component: `step`, `stl`, `obj`, `3mf`; `dxf` or `svg` of a sketch (`--sketch <id>`) or of the flat pattern (`--flat-pattern`) |
| `picture <project> <document> <file>` | A PNG of a component or an assembly: `--view iso` (default), `front`, `back`, `top`, `bottom`, `left` or `right`; `--width`, `--height` (800 × 600); `--white` for a white background |
| `convert <input> <output>` | Converts a file, formats from the extensions: `bracket.step` to `bracket.stl`, `logo.svg` to `logo.dxf` |
| `run <script> [arguments]` | Runs a script (below) |
| `open-git <url>` | Opens a project from a git repository (`--cors-proxy <url>` if needed) |
| `sync <project>` | Syncs a project with its repository; conflicts are left for the app |
| `mcp` | Serves CADence to an AI agent (below) |

Projects and documents are given by id or by name: `cadence export "Desk organizer" "Pen tray" 3mf -o tray.3mf`. Exports go to the current folder unless `--exports <dir>` or `-o <path>` says otherwise. For git, the sign-in comes from `CADENCE_GIT_USERNAME` and `CADENCE_GIT_PASSWORD` (a token).

## Scripts

A script is a JavaScript module (or TypeScript, which Node 24 runs as is) whose default export receives the scripting API and the remaining arguments:

```js
// washer.mjs: cadence run washer.mjs "M8 washer"
export default async function (cadence, [name]) {
  const { firstDocument } = (await cadence.projects.createProject(name)).value;
  const washer = await cadence.component(firstDocument.id);
  await washer.run(
    { type: 'create-sketch', id: 's', plane: 'XY' },
    { type: 'add-circle', sketchId: 's', id: 'outer', x: 0, y: 0, diameter: 16 },
    { type: 'add-circle', sketchId: 's', id: 'inner', x: 0, y: 0, diameter: 8.4 },
  );
  const ring = washer.summary().sketches[0].profiles.find((p) => p.holes === 1);
  await washer.run({
    type: 'add-feature',
    feature: { type: 'extrude', id: 'e', name: 'Washer', suppressed: false, sketch: 's', profiles: [ring.id], distance: '1.6 mm', direction: 'normal', operation: 'new-body' },
  });
  console.log(await washer.export('step'));
}
```

The API ([[src/automation/api.ts]]):

- `cadence.projects`: the whole Project Manager: create, rename and delete projects and documents, import files, project parameters, versions and sync. Methods return results (`{ ok, value }` or `{ ok: false, error }`).
- `cadence.project(idOrName)`, `cadence.document(idOrName, project?)`: find them.
- `cadence.component(documentId)`: a component open for scripting:
  - `run(...commands)` runs design commands in order and throws a `CadenceError` at the first refused one;
  - `summary()` is the component as plain data: parameters, timeline with errors, sketches with their profiles (id, area, extent), bodies with their face and edge names;
  - `export(format, { to?, bodies?, quality? })`, `exportSketch(id, format)`, `exportFlatPattern(format)` return the written file's path;
  - `properties()`, `validate()`, `measure(refs)`, `simulate()` (the strength check of the setup stored with `set-simulation`), `undo()`, `redo()`, `state()`.
- `cadence.assembly(documentId)`: `run(...commands)`, `interference()`, `export(format)`.

**Commands** are the same ones the app records for every change ([[Architecture/Decisions#ADR-10]]): `create-sketch`, `add-sketch-geometry`, `add-constraint`, `set-dimension`, `add-feature`, `edit-feature`, `add-parameter`, `set-material`, `set-process` and the others in [[src/core/managers/design/design-manager.ts]]. Features are described in [[src/core/contracts/feature.ts]] and sketches in [[src/core/contracts/sketch.ts]]. Three shorthands add fully constrained outlines ([[src/automation/shapes.ts]]):

| Shorthand | Adds |
| --- | --- |
| `{ type: 'add-rectangle', sketchId, id, x, y, width, height }` | A rectangle from its bottom left corner; `width` and `height` may be expressions (`'width'`, `'2 * wall'`) |
| `{ type: 'add-circle', sketchId, id, x, y, diameter }` | A circle around (x, y) |
| `{ type: 'add-polygon', sketchId, id, points: [[x, y], …] }` | A closed outline through fixed points |

Ids are yours to choose; they make later commands readable (`profiles`, `sketch`, `itemId`). Faces and edges for fillets, chamfers, shells or sketches on faces are named in `summary().bodies`.

## AI agents (MCP)

`cadence mcp` is an MCP server over stdio. Add it to an MCP client with the full path to the built file, for example:

- **Claude Code:** `claude mcp add cadence -- node <repository>/dist/automation/cadence.mjs mcp`
- **Claude Desktop** and other clients with a JSON configuration:

  ```json
  {
    "mcpServers": {
      "cadence": {
        "command": "node",
        "args": ["<repository>/dist/automation/cadence.mjs", "mcp", "--folder", "<projects folder>"]
      }
    }
  }
  ```

The server tells the agent how to model when it connects, and offers these tools:

| Tool | What it does |
| --- | --- |
| `list_projects`, `create_project`, `list_documents`, `create_document`, `import_file` | Projects and documents |
| `set_project_parameters` | Parameters for every component of a project |
| `get_component` | The component as data (as `summary()` above) |
| `edit_component` | Runs commands in order and returns the component; a refused command is reported with its number and reason |
| `undo_component` | Undoes the last change |
| `component_properties`, `check_component` | Mass properties; the print or laser checks |
| `export_component`, `export_imported` | Files for printing, cutting or other CAD programs; returns the path |
| `render_picture` | A picture of a component or an assembly from a view, returned as an image the agent can look at |
| `command_reference` | Every command and feature as TypeScript types with their documentation |

Ask the agent for a part ("a wall bracket for a 25 mm pipe, 4 mm thick, with two screw holes, as a 3MF"), and open the result in the desktop app, or sync it to the web app through git.
