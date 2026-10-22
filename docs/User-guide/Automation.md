# Automation

Model, check, convert and export without the app: with scripts, on the command line, or by an AI agent through the Model Context Protocol (MCP). All three work on project folders, the way the desktop app keeps projects, and use the same geometry kernel as the app. In the app, the [script console](#the-script-console) runs scripts against the open project, and [plugins](#plugins) add features, generators and exporters others wrote.

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
| `export <project> <document> <format>` | Exports a component: `step`, `stl`, `obj`, `3mf`; `dxf` or `svg` of a sketch (`--sketch <id>`) or of the flat pattern (`--flat-pattern`: flanges, flanges on flanges, hems and miter flanges unfolded, corner reliefs cut) |
| `picture <project> <document> <file>` | A PNG of a component or an assembly: `--view iso` (default), `front`, `back`, `top`, `bottom`, `left` or `right`, or `--direction x,y,z` (towards the camera) with `--up x,y,z`; `--width`, `--height` (800 × 600); `--white` for a white background; `--focus`, `--hide`, `--ghost` with body or instance ids (`a,b`) to zoom onto, leave out or show see-through; assemblies also `--explode <view>` (with `--steps n`) or `--study <id> --time <seconds>` |
| `convert <input> <output>` | Converts a file, formats from the extensions: `bracket.step` to `bracket.stl`, `logo.svg` to `logo.dxf`, a KiCad board `board.kicad_pcb` to `board.step` |
| `run <script> [arguments]` | Runs a script (below) |
| `install-plugin <project> <file>` | Installs a plugin (a `.cadence-plugin.js` file) into a project ([Plugins](#plugins)) |
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

**Commands** are the same ones the app records for every change ([[Architecture/Decisions#ADR-10]]): `create-sketch`, `add-sketch-geometry`, `add-constraint`, `set-dimension`, `add-feature`, `edit-feature`, `add-parameter`, `set-material`, `set-body-material` (a body's own material; without `material`, the component's again), `move-folder` (a timeline folder with the folders in it), `set-process` and the others in [[src/core/managers/design/design-manager.ts]]. Features are described in [[src/core/contracts/feature.ts]] and sketches in [[src/core/contracts/sketch.ts]]. Three shorthands add fully constrained outlines ([[src/automation/shapes.ts]]):

| Shorthand | Adds |
| --- | --- |
| `{ type: 'add-rectangle', sketchId, id, x, y, width, height }` | A rectangle from its bottom left corner |
| `{ type: 'add-circle', sketchId, id, x, y, diameter }` | A circle around (x, y) |
| `{ type: 'add-polygon', sketchId, id, points: [[x, y], …] }` | A closed outline through the points |

Sizes and positions are numbers (mm) or expressions (`'width'`, `'2 * wall'`, `'rod + 15'`). A point given by numbers is fixed; one given by an expression is dimensioned from the sketch origin, so it follows the parameters.

Ids are yours to choose; they make later commands readable (`profiles`, `sketch`, `itemId`). Faces and edges for fillets, chamfers, shells or sketches on faces are named in `summary().bodies`.

**Measuring, blocks and wraps** (phase 35):

- A dimension with `reference: true` drives nothing; `summary().sketches` lists what it measures under `references` (mm, or degrees for angles). Give it a `name` and parameters and later features can use it (`{ type: 'add-parameter', parameter: { id, name: 'half', expression: 'diagonal / 2' } }`). `set-dimension-reference` turns a dimension into a reference or back into a driving one at the value it shows. A dimension that would over-constrain is refused with a message that it can go in as a reference.
- `{ type: 'make-block', sketchId, block, name, ids, base: [x, y], insertion }` makes a block sketch of the chosen points, curves and texts and places it back; `{ id, kind: 'block', block: <block sketch>, document?: <another component of the project>, origin: <point>, angle: '30 deg', scale: '2', construction: false }` (with `add-sketch-geometry`) places it again; its pieces are `<placement>:<id in the block>`. `set-block` turns and scales a placement, `explode-block` makes it plain curves, `set-sketch-block` marks any sketch as a block. Editing the block sketch updates every placement.
- The feature `{ type: 'wrap', sketch, profiles, face, method: 'wrap' | 'project', depth, operation: 'emboss' | 'engrave' }` raises or cuts profiles (letters too) on a round or any face; see [[User guide/Part modeling#Wrap: emboss and engrave on round faces]].
## Scripts in the sandbox
`cadence run` runs script files you trust as Node modules. Scripts from agents (`run_script`), the app's script console and plugin generators run in a sandbox instead ([[Architecture/Decisions#ADR-60]]): a JavaScript engine of their own (QuickJS) that reaches nothing but the scripting API. The script is the body of an async function:
```js
// Ten plates, 10 to 100 mm long.
const { project } = (await cadence.projects.createProject('Plates')).value;
for (let i = 1; i <= 10; i++) {
  const created = (await cadence.projects.createDocument(project.id, 'component', `Plate ${i}`)).value;
  const plate = await cadence.component(created.id);
  await plate.run({ type: 'create-sketch', id: 's', plane: 'XY' }, { type: 'add-rectangle', sketchId: 's', id: 'r', x: 0, y: 0, width: 10 * i, height: 20 });
  const [profile] = (await plate.summary({ only: ['sketches'] })).sketches[0].profiles;
  await plate.run({ type: 'add-feature', feature: { type: 'extrude', id: 'e', name: '', suppressed: false, sketch: 's', profiles: [profile.id], distance: '3 mm', direction: 'normal', operation: 'new-body' } });
}
return 'done';
```
- **What it has:** `cadence` (the API above, with `cadence.projects`), `params` (the values asked for, numbers in mm and degrees), `args` (`run_script`'s arguments), `project` (the project it runs for: `id` and `name`), and `console`. No files, no network, no Node.
- **Every call returns a promise**, `summary()` and `changes()` included: `await` them. Components, assemblies and drawings are handles to the open documents; pictures come back as base64. The types are in [[src/automation/script-api.ts]] (the MCP resource `cadence://reference/scripts`).
- **Files** go to the exports folder only: `export('stl', { to: 'boxes/box.stl' })` writes below it, a path outside it is refused (in the app, exports are downloads).
- **Limits:** 256 MB of memory, and a time limit (`run_script`: 2 minutes by default, at most 10; the console: 10 minutes). A script that never waits is stopped there too.
- **The answer:** what `return` gave, the lines it printed, and the documents it created, changed or deleted.
## The script console
In the editor, **Scripts and plugins** (the `</>` button, or the command palette) opens the project's scripts:
- **Kept scripts** are saved with the project: they travel with its versions, git and archives. A new script starts as a generator of boxes, with `size` as its parameter.
- **Parameters** (a name, a default and a kind: length, number, angle or text) are asked before each run, so one script makes the same part in many sizes. The script reads them as `params.size`.
- **The editor** completes the API: after `cadence.`, `cadence.projects.` or an open document, a list of members with their types (arrows and Enter or Tab to take one). *The scripting API's types* shows all of them. Tab indents, Ctrl+Enter runs.
- **Run** runs the script in a worker against the project; the output shows what it printed, what it returned, and the documents it made or changed, which the project then shows. **Stop** ends it at once.
## Plugins
A plugin adds **features** (parts of a component's timeline that regenerate with its parameters), **generators** (scripts with parameters) and **exporters** (file formats) to a project ([[Architecture/Decisions#ADR-60a]]). It is one JavaScript file whose body returns the plugin; the sample is [[public/plugins/trays.cadence-plugin.js]]:
return {
  id: 'acme.trays', name: 'Trays', version: '1.0.0', cadence: 1,
  features: {
    tray: {
      label: 'Tray',
      parameters: [{ name: 'width', default: '60 mm', kind: 'length' }, { name: 'height', default: '20 mm', kind: 'length' }],
      // Lengths in mm; solids are outlines in the feature's plane, extruded by height from z.
      build: ({ width, height }) => [{ outline: [[0, 0], [width, 0], [width, 40], [0, 40]], holes: [], z: 0, height }],
    },
  },
  generators: { set: { label: 'Set of trays', parameters: [], run: async (cadence, params, { project }) => { /* the scripting API */ } } },
  exporters: { scad: { label: 'OpenSCAD', extension: 'scad', mediaType: 'text/plain', export: ({ name, bodies }) => '…' } },
};
- **Install** it into a project: in the app, *Install plugin…* in the Scripts dialog (or *Install the sample plugin*); `cadence install-plugin <project> <file>`; the MCP tool `install_plugin`. A newer version of the same id replaces the older one.
- **Features** are added to the open component from the Scripts dialog (or with `add-feature` and `type: "plugin"`), with their parameters as expressions (`size`, `2 * wall`); the feature dialog edits them later. The component regenerates them like any other feature, in the app and in the MCP server, since the plugin travels with the project. A project without the plugin, or with another major version of it, shows the feature with the reason it failed.
- **Generators** run from the Scripts dialog, or with `run_script` (`generator: "<plugin id>/<name>"`). **Exporters** write the open component's triangles to their format (Scripts dialog, `export_component` with `format: "plugin"`, `component.exportWith(plugin, exporter)`).
- Plugin code runs in the sandbox: features and exporters get only their values, generators the scripting API. A feature has 10 s and 64 MB to build.
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
| `list_projects`, `create_project`, `create_project_from_template`, `rename_project`, `delete_project` (to the trash), `duplicate` | Projects (and copies of documents) |
| `list_documents`, `create_document` (component, assembly or drawing), `rename_document`, `delete_document` (to the trash), `import_file` (also in place of an imported document; with `triangles`, a mesh is also kept repaired and simplified to about that many triangles; a KiCad board answers with its holes and mounting holes, named for joints) | Documents |
| `trash` | The trash: list it, restore a project or a document (with its history), delete one for good, empty it |
| `project_notes` | A project's description (Markdown) and attachments: get, set, attach a file by path or a link, read a file (text files answer their text, others are written to the exports folder), remove |
| `list_libraries`, `library`, `insert_library_part` | Libraries: the standard parts and the projects marked as libraries, with their parts (`match` filters them); mark a project as a library, list and take updates of the parts a project uses, whether a part follows its library on its own; insert a part into an assembly by designation (`ISO 4762 M3 x 12`) or name, with `at` onto a hole's round face or circular edge |
| `export_project`, `import_project` | `.cadence` archives, with the version history and the libraries the project uses if asked |
| `versions` | The version history: list (a project's or a document's), record, restore a document, compare a document in two versions (or one and now) in words, with the volume added and removed for components; name and unname versions |
| `sync_project`, `open_git` | Git: a project synced with its repository (documents changed on both sides merged item by item; conflicting items answered with `resolutions`, per item `<path>#<item path>` or per document; `libraries` syncs the libraries it uses too), or opened from one; sign-in from `$CADENCE_GIT_USERNAME` and `$CADENCE_GIT_PASSWORD` |
| `set_project_parameters` | Parameters for every component of a project |
| `get_component` | The component as data (as `summary()` above), with the same filters; `near` measures to the face or edge itself |
| `edit_component` | Runs commands in order and answers with what changed: timeline items, sketches and their profiles, the bodies' face counts and new face names; a refused command is reported with its number, reason and the ids involved |
| `undo_component` | Undoes the last change (or redoes it); answers with what changed |
| `component_properties`, `check_component`, `simulate_component` | Mass properties; the print or laser checks; the strength check of the stored setup |
| `check_sketch`, `broken_references` | What a sketch leaves free and the relations the sketcher suggests (`add-suggested-constraints` adds them); references a feature lost, with candidates |
| `measure` | Sizes, distances and angles of faces, edges and vertices, of a component or of instances of an assembly |
| `export_component`, `export_imported` | Files for printing, cutting or other CAD programs, the HTML viewer, glTF (`glb`) and USDZ (`usdz`, metres) for other viewers and augmented reality, and the configuration table (CSV); returns the path |
| `get_assembly`, `edit_assembly`, `undo_assembly` (also redo) | An assembly as data; runs assembly commands (instances, joints, links, patterns, motion studies, exploded views) and answers briefly: what the commands created, the joints whose values changed, where instances moved, and which joints fail; with a study and a time, the assembly at that moment as numbers |
| `reach` | Inverse kinematics: the joint values that put a point of an instance at a place (and its directions along others), for open and closed chains, with how far off the targets stay; `apply` sets them |
| `joint_loads` | The torque or force each actuator must hold, as the assembly stands or the largest over a study (with accelerations), from the parts' weight and payloads |
| `check_assembly`, `assembly_properties`, `export_assembly` | Overlaps now or collisions while a study plays (with progress notifications and `seconds` as a time limit); mass and the bill of materials; STEP, 3MF, STL or OBJ, the bill of materials (CSV), the HTML viewer, glTF (`glb`) and USDZ (`usdz`) and build instructions (PDF) from an exploded view |
| `get_drawing`, `edit_drawing`, `undo_drawing`, `export_drawing` | Technical drawings: the sheet, its views (where they are on the sheet, and how they were drawn when not exactly) and annotations, and how many anchors each view offers. Anchors (points, circles and lines, once per place, with a short `ref`, where they lie on the sheet and in the model) when asked for: by view, kind, a sheet point, a circle diameter, or the outermost points (`extremes`); `only` picks the parts. Annotations attach by `{ "view", "ref" }` or by name (also a surface finish's `edge`). Views take full, offset (`steps`) and half sections; dimensions take tolerances and ISO 286 fits, and `axis` on isometric views; threads offer `thread:<feature>` circles to call out; assembly views name each part's anchors by instance ([[CAD-164]] … [[CAD-167]]). Drawing commands with brief answers; PDF and DXF |
| `render_picture` | A picture returned as an image the agent can look at: of a component or an assembly from a view or a direction, zoomed onto bodies or instances, others hidden or see-through, cut open by a section plane; assemblies also exploded or at a moment of a study; a drawing's sheet as the PDF prints it (or one view of it); an imported 3D file |
| `animate_study` | A motion study as an animated GIF (its path) and a sheet of moments to look at: one camera for all frames, and moments that show different poses |
| `command_reference` | The commands and contracts as TypeScript types with their documentation, by `topic`: `commands`, `sketch`, `features`, `parts` (gears, ring gears, bevel gears, worms, springs, screws, bearings …), `document`, `assembly`, `drawing`; each short enough for an agent to read whole |
| `run_script` | A whole script in the sandbox ([above](#scripts-in-the-sandbox)): loops and calculations in one call, within a time limit (`seconds`); answers with its value, its output and the documents it touched. With `project` and `generator`, a script kept with the project or a plugin generator, with `parameters` |
| `list_scripts`, `install_plugin` | A project's kept scripts and plugins (their features, generators and exporters); a plugin installed from a file |

**Resources and prompts.** Besides tools, the server offers resources to read: the command reference by topic (`cadence://reference/commands`, …, and `cadence://reference/scripts` for scripts) and this user guide, page by page (`cadence://guide/Automation`, …). Its prompts start common jobs with their arguments: `part_from_sketch` (a part, how it is made, the file to export), `drawing_of_part` (a component and its views), `assembly_of_parts` (the parts and how they move) and `parts_by_script` (a series of parts in one `run_script`).

**Agents can do what people do.** Every operation of the Project, Design, Assembly and Drawing Managers is a tool or part of one ([[CAD-124]]). Left out are only what serves the app's own screen: thumbnails, previews while dragging, screen recordings (agents get `animate_study`) and the colours of surface analysis.

**Long calls, cancelling and failures.** The server answers requests side by side, so `list_projects` answers while a long `check_assembly` runs; the check reports progress part by part. A client that cancels a call (`notifications/cancelled`) stops the geometry kernel's work: the call gets no answer and the next one starts a new kernel. When the kernel runs out of memory or fails, the feature that made it fail is refused with the reason, the kernel starts again, and the call's answer says that the open documents were read again ([[Architecture/Decisions#ADR-52]]).

**What answers tell.** `edit_component` lists faces that were only renumbered (`renumbered`: a face `~2` that is now `~3`) apart from faces made and removed; a sketch's `frame` is where it lies (its origin and its u and v axes in the model); a face whose body is missing names the feature that failed or is suppressed. A circle or rectangle placed by numbers is held by a fix (`c:fix`) that `move-point` moves along with its point.

**The desktop app follows the agent.** With the MCP server on the desktop app's project folders, a document the agent changes updates in the app's open editor, and new, renamed and deleted documents show in its lists ([[CAD-150]]).

The server writes files without a `path` to `CADence exports` in the documents folder (or `--exports <dir>`), and says so when it connects.

Ask the agent for a part ("a wall bracket for a 25 mm pipe, 4 mm thick, with two screw holes, as a 3MF"), and open the result in the desktop app, or sync it to the web app through git.
