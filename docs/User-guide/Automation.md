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
| `picture <project> <document> <file>` | A PNG of a component or an assembly: `--view iso` (default), `front`, `back`, `top`, `bottom`, `left` or `right`, or `--direction x,y,z` (towards the camera) with `--up x,y,z`; `--width`, `--height` (800 × 600); `--white` for a white background; `--focus`, `--hide`, `--ghost` with body or instance ids (`a,b`) to zoom onto, leave out or show see-through; assemblies also `--explode <view>` (with `--steps n`) or `--study <id> --time <seconds>` |
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

- `cadence.projects`: the whole Project Manager: create, rename and delete projects and documents, import files, project parameters, versions and sync, sharing on a CADence server. `cadence.compareVersions(document, from, to?)` says what changed between versions in words. Methods return results (`{ ok, value }` or `{ ok: false, error }`).
- `cadence.project(idOrName)`, `cadence.document(idOrName, project?)`: find them.
- `cadence.component(documentId)`: a component open for scripting:
  - `run(...commands)` runs design commands in order and throws a `CadenceError` at the first refused one (with the ids involved, such as the constraints of a conflict);
  - `summary(filter?)` is the component as plain data: parameters, timeline with errors, sketches with their profiles (id, area, extent), bodies with their faces (and centres) and edges (and middles). A filter lists part of it: `only` some parts, one `sketch` or `body`, faces and edges whose names `match` a pattern (`f:pocket:*`) or lie `near` a point (`within` mm). `changes(before)` says what changed since an earlier summary;
  - `export(format, { to?, bodies?, quality? })`, `exportSketch(id, format)`, `exportFlatPattern(format)` return the written file's path;
  - `properties()`, `validate()`, `measure(refs)`, `simulate()` (the strength check of the setup stored with `set-simulation`), `freedom(sketch)`, `suggestConstraints(sketch)`, `brokenReferences(item)`, `exportConfigurations()`, `exportViewer()`, `undo()`, `redo()`, `state()`;
  - besides design commands, `run` takes `insert-drawing` (an imported DXF, SVG or picture into a sketch), `import-configurations` (the configuration table from CSV) and `add-suggested-constraints`.
- `cadence.assembly(documentId)`: an assembly open for scripting: `run(...commands)`, `summary()` (instances where they are, joints with their errors, links, patterns, studies, exploded views), `changes(before)`, `undo()`, `redo()`, `interference()`, `collisions(study)`, `measure(refs)`, `properties()`, `billOfMaterials()`, `picture(options)` (also exploded, at a moment of a study, or cut by a `section`), `animation(study)` (a GIF and a sheet of moments), `export(format)`, `exportBillOfMaterials()`, `exportViewer()`, `exportInstructions(view)`, `close()`.
- `cadence.drawing(documentId)`: a technical drawing open for scripting: `run(...commands)` (the drawing commands of [[src/core/managers/drawing/drawing-manager.ts]]), `summary(filter?)` (sheet, views with their boxes, annotations, anchors by view, kind or near a sheet point), `changes(before)`, `undo()`, `redo()`, `picture({ width, view })`, `export('pdf' | 'dxf')`, `close()`.
- `cadence.settled()`: resolves once the work the script started is done (components rebuilt for assemblies, their results written). `cadence run` waits for it before it ends.

**Open documents stay current.** Components and assemblies stay open between calls, and follow changes: an assembly uses a component's new shape as soon as `run` or `edit_component` changed it, and catches up with changes the desktop app or another script made in the same folder before each answer. A document changed by another process is opened again before the next edit, so the edit never overwrites the other change. While a component is still being rebuilt (more than two minutes), checks, pictures and exports of its assemblies refuse with `not-ready` and name it, rather than answer from its old shape; `edit_assembly` lists such components under `notReady`.

**Commands** are the same ones the app records for every change ([[Architecture/Decisions#ADR-10]]): `create-sketch`, `add-sketch-geometry`, `add-constraint`, `set-dimension`, `add-feature`, `edit-feature`, `add-parameter`, `set-material`, `set-process` and the others in [[src/core/managers/design/design-manager.ts]]. Features are described in [[src/core/contracts/feature.ts]] and sketches in [[src/core/contracts/sketch.ts]]. Three shorthands add fully constrained outlines ([[src/automation/shapes.ts]]):

| Shorthand | Adds |
| --- | --- |
| `{ type: 'add-rectangle', sketchId, id, x, y, width, height }` | A rectangle from its bottom left corner |
| `{ type: 'add-circle', sketchId, id, x, y, diameter }` | A circle around (x, y) |
| `{ type: 'add-polygon', sketchId, id, points: [[x, y], …] }` | A closed outline through the points |

Sizes and positions are numbers (mm) or expressions (`'width'`, `'2 * wall'`, `'rod + 15'`). A point given by numbers is fixed; one given by an expression is dimensioned from the sketch origin, so it follows the parameters.

Ids are yours to choose; they make later commands readable (`profiles`, `sketch`, `itemId`). Faces and edges for fillets, chamfers, shells or sketches on faces are named in `summary().bodies`.

## AI agents (MCP)

`cadence mcp` is an MCP server over stdio. Add it to an MCP client with the full path to the self-contained binary (below) or the built file, for example:

- **Claude Code, from any project:** `claude mcp add cadence -- <path>/cadence-cli mcp` (add `-s user` for all projects). The desktop app's About dialog shows the command for the one installed with it.
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

### The self-contained binary

Every [release](https://github.com/h3ll5ur7er/CADence/releases/latest) has it for Windows, macOS (Apple silicon) and Linux, on its own (`cadence-cli-windows-x64.exe`, `cadence-cli-macos-arm64`, `cadence-cli-linux-x64`) and in the desktop installers, next to the app: in the installation folder on Windows, in `CADence.app/Contents/MacOS/` on macOS, in `/usr/bin/` from the Linux `.deb` (the AppImage's changes folder on every start: use the file on its own there). `npm run build:binary` builds `dist/binary/cadence-cli.exe` (`cadence-cli` on Linux and macOS) for the platform it runs on: one file of about 120 MB with Node, CADence, the geometry kernel, the sketch solver and the fonts inside ([[Architecture/Decisions#ADR-50]]). Copy it anywhere (say `C:\Tools\cadence-cli.exe`); it needs neither Node nor this repository. It takes the same commands and options as `npm run cadence`, so `cadence-cli mcp` serves the projects of the desktop app (or `--folder`) and writes files to *CADence exports* in the documents folder (or `--exports`). On first start it unpacks its kernels and fonts into a `cadence-…` folder of the temporary directory. Windows may warn that its signature is broken: the Node it is made from was signed, the binary is not. On macOS, a downloaded `cadence-cli-macos-arm64` needs `chmod +x` and, since it is not notarized, `xattr -d com.apple.quarantine` once. The kernels it unpacks can be replaced by modified builds (as the LGPL allows): put them in its `cadence-…` folder under the same names.

The server tells the agent how to model when it connects, and offers these tools:

| Tool | What it does |
| --- | --- |
| `list_projects`, `create_project`, `create_project_from_template`, `rename_project`, `delete_project`, `duplicate` | Projects (and copies of documents) |
| `list_documents`, `create_document` (component, assembly or drawing), `rename_document`, `delete_document`, `import_file` (also in place of an imported document) | Documents |
| `export_project`, `import_project` | `.cadence` archives, with the version history if asked |
| `versions` | The version history: list (a project's or a document's), record, restore a document, compare a document in two versions (or one and now) in words, with the volume added and removed for components; name and unname versions |
| `sync_project`, `open_git` | Git: a project synced with its repository (documents changed on both sides merged item by item; conflicting items answered with `resolutions`, per item `<path>#<item path>` or per document), or opened from one; sign-in from `$CADENCE_GIT_USERNAME` and `$CADENCE_GIT_PASSWORD` |
| `set_project_parameters` | Parameters for every component of a project |
| `get_component` | The component as data (as `summary()` above), with the same filters; `near` measures to the face or edge itself |
| `edit_component` | Runs commands in order and answers with what changed: timeline items, sketches and their profiles, the bodies' face counts and new face names; a refused command is reported with its number, reason and the ids involved |
| `undo_component` | Undoes the last change (or redoes it); answers with what changed |
| `component_properties`, `check_component`, `simulate_component` | Mass properties; the print or laser checks; the strength check of the stored setup |
| `check_sketch`, `broken_references` | What a sketch leaves free and the relations the sketcher suggests (`add-suggested-constraints` adds them); references a feature lost, with candidates |
| `measure` | Sizes, distances and angles of faces, edges and vertices, of a component or of instances of an assembly |
| `export_component`, `export_imported` | Files for printing, cutting or other CAD programs, the HTML viewer and the configuration table (CSV); returns the path |
| `get_assembly`, `edit_assembly`, `undo_assembly` (also redo) | An assembly as data; runs assembly commands (instances, joints, links, patterns, motion studies, exploded views) and answers briefly: what the commands created, the joints whose values changed, where instances moved, and which joints fail |
| `check_assembly`, `assembly_properties`, `export_assembly` | Overlaps now or collisions while a study plays (with progress notifications and `seconds` as a time limit); mass and the bill of materials; STEP, 3MF, STL or OBJ, the bill of materials (CSV), the HTML viewer and build instructions (PDF) from an exploded view |
| `get_drawing`, `edit_drawing`, `undo_drawing`, `export_drawing` | Technical drawings: the sheet, its views (where they are on the sheet, and how they were drawn when not exactly) and annotations, and how many anchors each view offers. Anchors (points, circles and lines, once per place, with a short `ref`, where they lie on the sheet and in the model) when asked for: by view, kind, a sheet point, a circle diameter, or the outermost points (`extremes`); `only` picks the parts. Annotations attach by `{ "view", "ref" }` or by name. Drawing commands with brief answers; PDF and DXF |
| `render_picture` | A picture returned as an image the agent can look at: of a component or an assembly from a view or a direction, zoomed onto bodies or instances, others hidden or see-through, cut open by a section plane; assemblies also exploded or at a moment of a study; a drawing's sheet as the PDF prints it (or one view of it); an imported 3D file |
| `animate_study` | A motion study as an animated GIF (its path) and a sheet of moments to look at: one camera for all frames, and moments that show different poses |
| `command_reference` | The commands and contracts as TypeScript types with their documentation, by `topic`: `commands`, `sketch`, `features` (with the parts: gears, ring gears, screws, bearings …), `document`, `assembly`, `drawing`; each short enough for an agent to read whole |

**Agents can do what people do.** Every operation of the Project, Design, Assembly and Drawing Managers is a tool or part of one ([[CAD-124]]). Left out are only what serves the app's own screen: thumbnails, previews while dragging, screen recordings (agents get `animate_study`) and the colours of surface analysis.

**Long calls, cancelling and failures.** The server answers requests side by side, so `list_projects` answers while a long `check_assembly` runs; the check reports progress part by part. A client that cancels a call (`notifications/cancelled`) stops the geometry kernel's work: the call gets no answer and the next one starts a new kernel. When the kernel runs out of memory or fails, the feature that made it fail is refused with the reason, the kernel starts again, and the call's answer says that the open documents were read again ([[Architecture/Decisions#ADR-52]]).

**What answers tell.** `edit_component` lists faces that were only renumbered (`renumbered`: a face `~2` that is now `~3`) apart from faces made and removed; a sketch's `frame` is where it lies (its origin and its u and v axes in the model); a face whose body is missing names the feature that failed or is suppressed. A circle or rectangle placed by numbers is held by a fix (`c:fix`) that `move-point` moves along with its point.

The server writes files without a `path` to `CADence exports` in the documents folder (or `--exports <dir>`), and says so when it connects.

Ask the agent for a part ("a wall bracket for a 25 mm pipe, 4 mm thick, with two screw holes, as a 3MF"), and open the result in the desktop app, or sync it to the web app through git.
