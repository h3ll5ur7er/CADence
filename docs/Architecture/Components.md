# Components

The responsibilities and service contracts of every component in [[Architecture]]. The contracts below are *design-level*. The source of truth is each component's `index.ts` in `src/core`. Operations are business verbs, not CRUD, and every engine and manager operation is async (see [[Architecture#Deployment and threads]]).

[TOC]

## Clients

| Client | Responsibility |
| --- | --- |
| **Home** | Lists projects with their documents and thumbnails; creates, renames, deletes and opens projects and documents; imports files; lists the samples (the shipped templates) and starts the tour of a first part ([[Architecture/Decisions#ADR-62]]). |
| **Editor shell** | Routes to the mode matching the document kind; hosts toolbars, the feature/document tree, the properties panel and the viewport. On small screens it is a viewer: the documents in a drawer, the modes' modelling tools left out, a bar of touch tools (fit, home, measure, augmented reality) instead ([[Architecture/Decisions#ADR-62]]). |
| **Component editor** | Sketch tools, feature dialogs, timeline, parameters table, measure and validation panels. Translates user gestures into **Design commands**. |
| **Assembly editor** | Instance tree, joint tools, motion-study timeline and playback. Translates gestures into **Assembly commands**. |
| **Imported viewer** | Shows imported geometry and metadata; offers conversion and export. |
| **Viewport** | three.js scene: renders mesh DTOs, picks faces/edges/vertices by their persistent ids, camera navigation, view cube, grid. Pure presentation. |
| **Desktop shell** | The Tauri app hosting the web client; exposes the native file system and dialogs as IPC commands used by Resource Access, watches the project folders for changes of other processes ([[Architecture/Decisions#ADR-53]]), opens web links in the browser, and installs signed updates from GitHub releases ([[Architecture/Decisions#ADR-32]]). |
| **Automation** | Node client ([[src/automation/api.ts]]): the scripting API (the Project Manager plus components and assemblies opened for scripting, with shorthand commands for outlines), the command line and the MCP server over it ([[Architecture/Decisions#ADR-31]]). Composed by `createNodeCore` (project folders, exports written to a folder, the kernel in this thread). Whole scripts run sandboxed through the same API (`run_script`, [[src/automation/script.ts]]): the members a script may use are listed once ([[src/automation/script-api.ts]]), and the command line runs each script in a worker thread of its own ([[Architecture/Decisions#ADR-60]]). The MCP server also offers the command reference and the user guide as resources, and prompts for common jobs ([[src/automation/resources.ts]]). |
| **Script console** | The editor's Scripts dialog ([[src/app/editor/scripts-dialog.ts]]): scripts kept with the project, edited with the scripting API's types and completions, run in a Web Worker against the app's own core (the same membrane as the command line), with parameters asked first, and stopped by ending the worker; the project's plugins: installed from a file, their generators run, their features added to the open component, their exporters used ([[Architecture/Decisions#ADR-60a]]). |

Clients hold UI state in signals derived from the managers' state streams. They never hold domain logic.

## Managers

Managers encapsulate the volatility of a *workflow*: the sequence in which engines and resource access are used.

### Project Manager

```ts
interface ProjectManager {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(name: string): Promise<ProjectSummary>;
  renameProject(projectId: ProjectId, name: string): Promise<void>;
  deleteProject(projectId: ProjectId): Promise<void>;
  listDocuments(projectId: ProjectId): Promise<DocumentSummary[]>;
  createDocument(projectId: ProjectId, kind: 'component' | 'assembly', name: string): Promise<DocumentSummary>;
  renameDocument(documentId: DocumentId, name: string): Promise<void>;
  deleteDocument(documentId: DocumentId): Promise<void>;
  importFile(projectId: ProjectId, file: ExternalFile): Promise<Result<DocumentSummary>>;  // keeps the original (Asset Access)
  openImported(documentId: DocumentId): Promise<ImportedView>;
  previewImported(documentId: DocumentId): Promise<Result<ImportedContent>>;  // meshes + triangles, volume, extent; or sketch entities
  exportImported(documentId: DocumentId, format: ImportFormat): Promise<Result<void>>;  // converted through the Interchange Engine
  previewSimplified(documentId: DocumentId, triangles: number): Promise<Result<SimplifiedImport>>;  // a mesh repaired and decimated, to look at
  simplifyImported(documentId: DocumentId, triangles: number): Promise<Result<DocumentSummary>>;  // kept as "<name> (simplified)"
}
```

Imported documents keep their original file; their summaries carry the `format`, so lists can tell drawings from 3D files.

**Pictures** of documents (`saveThumbnail`, `thumbnail`, `projectThumbnail`) are PNGs the viewport takes once a model settles, kept as assets (`thumbnail-<documentId>`).

**Versions** ([[Architecture/Decisions#ADR-30]]). The manager records the project through Version Access three seconds after the last `documentSaved` (published by the Design and Assembly Managers' commits) or project change: each document as JSON without its project id (`documents/<id>.json`), imported originals (`originals/<assetId>`, read only when not yet recorded) and the project's name and parameters (`project.json`). Recordings and syncs run one at a time. `projectHistory`, `documentHistory`, `nameVersion`, `unnameVersion` and `restoreDocument` (publishes `documentRestored`) work on that history.

**Copies, archives and templates** share one path ([[Architecture/Decisions#ADR-33]]): a project's content as a *bundle* (settings, documents, originals), given new ids where needed (`withNewIds`, references between documents follow), then stored as a new project. `duplicateProject`, `duplicateDocument`, `exportProject(id, { history })` (a `.cadence` zip, [[src/core/managers/project/project-bundles.ts]]), `importProject(file)` and `createFromTemplate(template)` use it. `replaceImported(id, file)` keeps the document, swaps its original, discards the results of components that use it and publishes `documentRestored` for them.

**Sync** (`setRemote`, `syncProject(id, credentials?, resolutions?)`, `openRemoteProject(remote, credentials?)`): record, fetch the remote's `main`, then push, fast-forward, or merge file by file against the common version. Files changed on both sides are reported as conflicts (`SyncOutcome` `conflicts`) until each has a resolution (`mine` or `theirs`); the merge version has both parents and is pushed. Taking versions applies their files: documents stored (and `documentRestored` published), documents no longer there discarded, missing originals kept as assets, project settings revised.

**Trash** ([[Architecture/Decisions#ADR-53]]): `deleteProject` marks the project (`trashedAt`); `deleteDocument` records a version, then discards the document and notes it in `Project.trash` with that version. `listTrash`, `restoreFromTrash` (a document from its version, `documentRestored`), `deleteFromTrash` and `emptyTrash`; what is older than 30 days goes when projects or the trash are listed.

**Notes** ([[CAD-149]]): `setProjectDescription`, `addAttachment` (a file kept as an asset, or a link), `removeAttachment`, `attachmentFile`; they are project settings, recorded with the versions.
**Libraries** ([[Architecture/Decisions#ADR-53a]]): `setLibrary`, `listLibraries` (the standard parts first), `libraryParts`, `useLibraryPart` (the project's copy of a library version of the part, made once; standard parts from [[src/core/managers/project/standard-library.ts]]), `libraryUpdates`, `updateLibraryParts`, `setLibraryFollow`. A library's new version replaces the parts that follow it always ([[src/core/managers/project/project-libraries.ts]]).
**Watching** (`watch`): one stream for clients of what lists show, from `documentChanged` (other tabs, windows and processes), `documentCreated`, `documentRenamed`, `documentRestored`, `documentDeleted`, `projectChanged`, `projectDeleted` and `projectParametersChanged`. Editors' stores use it to open their document again when it changed elsewhere ([[CAD-150]]).
**Compare and merge** ([[Architecture/Decisions#ADR-61]]): `compareVersions(document, from, to?)` gives a document in two versions (or one version and now), each with its project's parameters, and what changed (Revision Engine). Sync merges a document changed on both sides item by item; conflicting items come back in `SyncConflict.items` and are resolved per item (`<path>#<item path>`).
**Sharing** on a CADence server ([[Architecture/Server]], [[Architecture/Decisions#ADR-61a]]): `serverInfo`, `signInByName`, `serverUser`, `signOut`, `sharedProjects`, `shareProject` (creates it there, sets the remote with `server`, syncs), `sharing`, `setMember`, `removeMember`, `addViewLink`, `removeViewLink`, `openShared` and `openViewLink`, all through Server Access. Sign-ins are the client's; a project opened through a view link syncs with the link.
It publishes queued events such as `DocumentRenamed` and `DocumentDeleted`. The Assembly Manager reacts to them, for example by flagging broken instance references.

### Design Manager

A session-based manager for one component document. **All edits are commands**, which gives undo/redo, autosave and later collaboration from one mechanism. Implemented in [[src/core/managers/design/design-manager.ts]]:

```ts
interface DesignManager {
  open(documentId: DocumentId): Promise<Result<DesignSession>>;
}
interface DesignSession {
  state(): DesignState;                       // document, solved sketches (status, DOF, profiles, values), canUndo/canRedo
  subscribe(listener: (state: DesignState) => void): () => void;
  execute(command: DesignCommand): Promise<Result<void>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  previewDrag(sketchId, pointId, x, y): Promise<SketchView | undefined>;  // solves without committing
  exportSketch(sketchId, format: 'dxf' | 'svg', { compensateKerf? }): Promise<Result<void>>;  // kerf: laser profiles only
  insertDrawing(sketchId, importedDocumentId, idPrefix): Promise<Result<void>>;  // DXF/SVG curves into a sketch, one undoable change
  exportBodies(format: 'step' | 'stl' | 'obj' | '3mf'): Promise<Result<void>>;
  measure(refs: TopologyRef[]): Promise<Result<Measurement>>;  // area, length, radius, distance + points, angle
  brokenReferences(itemId): Promise<Result<BrokenReference[]>>;  // what an item lost, against the bodies just before it, with candidates by shape, then distance
  exportConfigurations(): Promise<Result<void>>;                   // the configuration table as CSV
  readConfigurations(csv): Result<ConfigurationImport>;            // read and checked (new, changed, removed, values that fail); applied with set-configurations
  properties(): Promise<BodyProperties[]>;  // volume, area, mass and material (each body's own, else the document's), centre of mass, box
  validate(): Promise<ValidationReport>;    // the document's manufacturing profile against bodies and sketches
}
```

`DesignCommand` is a discriminated union, and the caller supplies the ids of new elements. The commands:

- **Sketches:** `create-sketch` (on any `PlaneRef`), `add-sketch-geometry`, `add-constraint`, `set-dimension`, `set-dimension-reference` (driving or reference, [[Architecture/Decisions#ADR-54]]), `move-point`, `toggle-construction`, `delete-sketch-elements`.
- **Blocks** ([[Architecture/Decisions#ADR-54a]]): `make-block` (the selection into a new block sketch, placed back), `set-sketch-block`, `set-block` (a placement's angle and scale), `explode-block`; `blocks()` lists the project's blocks. When a component's blocks change, the results of the components that place them are discarded, and open sessions of those follow `documentSaved`.
- **Features:** `add-feature`, `edit-feature`.
- **Timeline items:** `suppress-item`, `rename-item`, `delete-item`.
- **Parameters:** `add-parameter`, `set-parameter`, `delete-parameter`.
- **Manufacturing:** `set-material` (name and density), `set-body-material` (one body's own, [[Architecture/Decisions#ADR-55]]), `set-process` (a printer or laser profile); all are validated (sizes above zero) and undoable ([[Architecture/Decisions#ADR-19]]).
- **Timeline folders:** `set-folder`, `move-folder`, `delete-folder`, `suppress-folder`; folders nest.

Before a command runs, the manager records the shape of every face and edge it names (`TopologyRef.shape`, from the Analysis Engine's `shapesOf`), so repairs can match lost references by shape.

The state also carries each item's status (ok, error with reason, suppressed), construction planes, body meshes and evaluated parameters.

**A command is atomic.** The manager applies it to a copy of the document (pure functions in [[src/core/managers/design/commands.ts]]), evaluates the sketch's dimension expressions and solves the sketch. It **rejects** the command and leaves the document untouched in three cases:

- an expression is invalid;
- constraints conflict (the message names the constraint kinds involved);
- the result would collapse a line, circle or arc to nothing. For example, horizontal *and* vertical on one line is something the solver could satisfy, but only by shrinking the line to zero length.

Accepted commands are saved immediately and pushed onto the undo history (state snapshots, up to 200). Commands run one at a time, so fast input such as drags never interleaves.

**Regeneration workflow** (owned by this manager only): evaluate parameters, then walk the timeline up to the rollback marker. For a sketch, resolve its plane through the Modeling Engine and then solve it through the Sketch Engine. For a feature, apply it through the Modeling Engine. Engines cache by content hash, so only items downstream of a change are recomputed.

**Publishing results.** After a successful regeneration at the end of the timeline, the manager snapshots the bodies (Modeling Engine `snapshotBodies`: OCCT B-rep, mesh and topology names) and keeps them as the document's **component result** through Asset Access, keyed by the document's content hash. Assemblies and exports of whole projects consume this result instead of regenerating the component themselves.

**Comparing versions** (`compareBodies(before, after, projectParameters?)`): both versions regenerated, and the Modeling Engine's `compare` of their bodies (added and removed material as meshes, volumes).

**Editing live** (`goLive(target)`, `leaveLive()`, `present(where)`; [[src/core/managers/design/live.ts]]): commands run here are sent through the server's relay (anchored, so others run exactly them) and kept pending until they come back; others' arrive in the relay's order, are run on the room's document, and the pending ones are run again on top. An undo goes as the whole document; coming back from behind the room's snapshot merges three ways. The state's `live` says the connection, who else is there and where, and what did not hold.

It also accepts the queued request `RegenerateComponent(documentId)` and answers it with the event `ComponentRegenerated`. This lets other managers get a fresh result without a synchronous manager-to-manager call.

### Assembly Manager

Implemented in [[src/core/managers/assembly/assembly-manager.ts]]:

```ts
interface AssemblyManager {
  open(documentId: DocumentId): Promise<Result<AssemblySession>>;
}
interface AssemblySession {
  state(): AssemblyState;    // document, components (loading/ready/missing + meshes), poses, placed instances, joint errors
  subscribe(listener): () => void;
  execute(command: AssemblyCommand): Promise<Result<void>>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  previewJoint(jointId, values): Promise<Result<poses>>;            // slider drags, not saved
  motion(studyId, fps): Promise<Result<MotionFrame[]>>;
  measure(refs: PlacedRef[]): Promise<Result<Measurement>>;      // faces, edges, vertices of instances where they are
  collisions(studyId, fps): Promise<Result<Collision[]>>;        // first hit of each pair while a study plays
  explode(viewId, steps?, amount?): poses;                       // an exploded view's steps applied
  billOfMaterials(): Promise<BomLine[]>; exportBillOfMaterials(): Promise<Result<void>>;  // CSV
  exportInstructions(viewId, pictures): Promise<Result<void>>;   // PDF: parts, a page per step, finished
  properties(): Promise<AssemblyProperties>;                     // mass, volume, centre of mass, by each component's material
  interference(): Promise<Interference[]>;
  exportAssembly(format: 'step' | 'stl' | 'obj' | '3mf'): Promise<Result<void>>;
  saveRecording(bytes, studyName): Promise<void>;                  // recorded video, through External File Access
  catchUp(): Promise<void>;                                        // components changed by another process, read again
  close(): void;                                                   // also lets go of the components' shapes
}
```

Instances can be components or imported 3D files (read once per original). Commands: `insert-instance` (with a `joint`, joined in the same change), `remove-instance` (with its joints and their keys), `rename-instance`, `move-instance` (refused for instances a joint places), `ground-instance`, `add-joint`, `edit-joint`, `remove-joint`, `set-joint-values`, `add-study`, `edit-study`, `remove-study`, `set-pattern`, `remove-pattern`, `set-link`, `remove-link`, `set-exploded-view`, `remove-exploded-view`. A joint command is refused when its joint cannot hold. The state also has each joint's frame in assembly coordinates (`jointFrames`, for the move handle) and the copies patterns make (`copies`, placed in `poses` after the kinematic solution).

The Assembly Manager never regenerates a component. It restores each instance from the component's **published result** (Asset Access → Modeling Engine `restore` + `tessellate`). When a result is missing or stale, it queues `regenerateComponent` to the Design Manager and reloads the component on `componentRegenerated` ([[Architecture/Decisions#ADR-11]]). It also follows `documentRenamed`, `documentDeleted` (a deleted component shows as missing), `resultPublished` (a component's new result from this process: the design editor, a script) and `documentChanged`: a component saved in another tab or window, relayed by the composition root over a `BroadcastChannel` ([[Architecture/Decisions#ADR-37]]). Other processes send no events; `catchUp()` reads again the components whose documents changed since they were loaded ([[Architecture/Decisions#ADR-47]]). Joint frames come from the Modeling Engine (`frameOf`, cached per component version); positions from the Kinematics Engine.

Whenever all its parts are there, the session also **publishes the assembly's result**: its shown parts placed where they are (Modeling Engine `place`, then `snapshot`; body ids are instance ids, `#k` for more bodies), with `resultPublished`, for drawings.

### Drawing Manager

A session-based manager for one drawing document ([[src/core/managers/drawing/drawing-manager.ts]]), loaded with the first drawing opened:

```ts
interface DrawingSession {
  state(): DrawingState;      // document, the sheet layout (paths, texts, arrows, anchors, views, instances, lost annotations), canUndo/canRedo
  subscribe(listener): () => void;
  execute(command: DrawingCommand): Promise<Result<void>>;   // set-sheet, set-title-block, add/edit/remove-view, add/edit/remove-annotation
  undo(): Promise<void>;
  redo(): Promise<void>;
  exportPdf(): Promise<Result<void>>;
  exportDxf(): Promise<Result<void>>;
  picture(options?): Promise<Result<Uint8Array>>;   // the sheet (or one view) as PNG
  catchUp(): Promise<void>;
  configurationsOf(source): Promise<{ id; name }[]>;  // what a view of the component may show
  close(): void;
}
```

Views are drawn from **published results** (of a component's configuration, when the view names one), like the Assembly Manager reads components: a stale component result is asked for with `regenerateComponent`; an assembly's result is the one its editor published. Each view is projected by the Modeling Engine (`drawView`, cached by result and view, and kept as the drawing's own result so other processes need not draw it again): exactly in the views worker when the host has one, and from the triangles (`method: 'mesh'`) when that takes longer than 20 s, then exactly in a second views worker without a time limit, one view at a time for all drawings, replacing the approximate view when done ([[Architecture/Decisions#ADR-58]]); views still being drawn show *Drawing…* on a sheet laid out first ([[Architecture/Decisions#ADR-49]]) and the whole sheet is laid out by one pure function ([[src/core/managers/drawing/layout.ts]]): the same lines, texts and arrows go to the editor, the PDF (the PDF writer of [[src/core/utilities/pdf/index.ts]]) and the DXF. Dimension values come from the model's persistent geometry, tolerances from ISO 286 tables ([[src/core/managers/drawing/fits.ts]]); hole and thread callouts from the component's hole and thread features, evaluated with the Parameter Engine; threads are drawn from the markers the component result carries; parts lists from the assembly document.
 It follows `componentRegenerated`, `resultPublished`, `documentChanged`, `documentRenamed`, `documentRestored` and `documentDeleted` ([[Architecture/Decisions#ADR-39]]).

## Engines

Engines encapsulate the volatility of an *activity*: an algorithm or a set of business rules. They are stateless apart from caches, and they never call other engines.

| Engine | Contract (core operations) | Implementation notes |
| --- | --- | --- |
| **Parameter** | `evaluate(expression, kind, scope) → Result<number>` (mm, radians); later `evaluate(parameters)` with dependency ordering | Own recursive-descent parser: arithmetic, `^`, functions (`sin`, `sqrt`, `min`, …), constants, names from the scope, and units (`mm cm m in ft`, `deg rad`) with dimensional analysis. Plain numbers are read as mm or degrees. It is pure and fast, so it is the one **synchronous** engine. |
| **Sketch** | `solve(sketch, values, drag?, fonts?) → SketchSolution`; `freedom(sketch, values)` (the points that can still move and their directions, circles without a size: the sketch pulled at each point); `suggest(sketch, values, idPrefix)` (relations and dimensions that fully define it as drawn, each kept only if it removes freedom without conflict): solved geometry, status (under / fully / over-constrained / failed), degrees of freedom, conflicting constraint ids, profiles, what its reference dimensions measure (`measured`; `measureDimension` measures one, [[Architecture/Decisions#ADR-54]]); pure editing functions `trim`, `extend`, `split`, `offset`, `fillet`, `chamfer` → a `SketchEdit` ([[Architecture/Decisions#ADR-25]]); `inferRelations` for imported geometry ([[Architecture/Decisions#ADR-27]]); texts laid out as outlines after solving ([[Architecture/Decisions#ADR-26]]) | planegcs (WASM, loaded lazily on the first solve). Drags pull a point with temporary constraints. For profiles, curves are split at intersections and faces are traced in the planar graph (tangent and curvature order at each vertex). Areas are exact (with circular-segment corrections), and islands become holes. Profile ids derive from the bounding curves, so they survive dimension changes. |
| **Modeling** | `drawView(bodies, { frame, hidden, cut?, method? }) → ViewGeometry` (OCCT hidden-line removal, or with `method: 'mesh'` a depth picture of the triangles ([[src/core/engines/modeling/hidden-lines.ts]]): visible and hidden edges, a section's cut and where it lies, and the named points, circles and lines to dimension, with cylinders' outlines, the outermost points, model positions and whether each is seen); `snapshotPlaced(parts) → bytes` (copies where an assembly puts them); `apply(request) → { bodies, toolKey?, thread?, error? }` for extrude, revolve, loft, sweep (along sketch curves or a helix), hole, part (standard parts, involute gears (profile-shifted), ring gears, bevel gears and racks as smooth curves ([[src/core/engines/modeling/gears.ts]]), worms and springs swept along helices ([[src/core/engines/modeling/helices.ts]]), printing parts: [[src/core/engines/modeling/parts.ts]]), thread, rib, fillet (constant or varying), chamfer, shell, draft, linear/circular/path pattern, mirror, wrap (profiles rolled onto a cylinder or cone, or projected onto any face, embossed or engraved: [[src/core/engines/modeling/wrap.ts]], [[Architecture/Decisions#ADR-54b]]), and the body operations combine, split, move/copy and scale; `pointOf(bodies, ref) → Vec3`; `planeOf(bodies, face) → PlaneFrame`; `tessellate(bodies) → BodyMesh[]`; `compare(before, after) → BodyDifference` (material added and removed between two versions); `frameOf(bodies, ref)` (joint frames, [[Architecture/Decisions#ADR-21]]); `snapshot(bodies) → bytes` and `restore(bytes, prefix)` (component results: B-rep text plus names in topological order) | OCCT (`replicad-opencascadejs`, through `replicad`) in the geometry worker. Generative naming ([[Architecture/Decisions#ADR-15]], [[Architecture/Decisions#ADR-44]]); booleans of our own that fall back when a simplified result is invalid or has the wrong volume, and loft sections lined up before lofting ([[Architecture/Decisions#ADR-43]]); results validated with `BRepCheck_Analyzer`; outcomes cached by request content hash. |
| **Analysis** | `measure(bodies, refs) → Result<Measurement>`; `properties(bodies, density, densities?) → BodyProperties[]` (`densities` by body); `shapesOf(bodies, refs)` (kind, size, radius of faces and edges); `validate({ bodies, sketches }, profile) → Check[]` | In the geometry worker ([[src/core/engines/analysis/index.ts]]). Measures and mass properties with OCCT (`BRepExtrema_DistShapeShape`, `GProp`). **Print rules:** closed valid solid, build volume (also turned by 90°), overhangs steeper than the profile allows (bed contact excluded), wall thickness by ray casting (fail below one nozzle width, warn below two). **Laser rules:** body thickness = sheet, closed outlines, laser bed, kerf compensation possible. Each check names the faces it is about. TypeScript on cached meshes ([[Architecture/Decisions#ADR-18]]). `interference(placed parts, pairs?)`: OCCT common of the pairs whose boxes and meshes meet (or one inside the other: [[Architecture/Decisions#ADR-46]]); touching, up to a ten-thousandth of the smaller part's volume, is not interference. `simulate(meshes, setup, material, byBody?) → Result<SimulationResult>` (each body of its own material): a linear static strength check from the bodies' display meshes, in TypeScript ([[Architecture/Decisions#ADR-41]]). |
| **Sheet Metal** | `flatPattern(frame, profiles, flanges, rules) → { cuts, bends }`; `bendAllowance(angle, rules)` | Pure TypeScript ([[src/core/engines/sheet-metal/index.ts]]): the base flange's outlines with each flange (edge flange, hem, piece of a miter flange) unfolded beyond the flat piece it stands on, its ends mitred where it has them, a bend line through each bend, and corner reliefs where two flanges meet ([[Architecture/Decisions#ADR-29]], [[Architecture/Decisions#ADR-57]]). |
| **Revision** | `compareDocuments(before, after) → DocumentChange[]`; `mergeDocuments(base, mine, theirs, { resolutions, time }) → { document, conflicts }` | Pure TypeScript, synchronous ([[src/core/engines/revision/revision.ts]]): a shape per document kind says which lists have items (by id, parameters by name; sketches with elements inside); the rest are single values ([[Architecture/Decisions#ADR-61]]). |
| **Kinematics** | `solve(model, driven?) → { poses, values, placed, error? }`; `simulate(model, study, fps) → { frames, error? }` | Pure TypeScript, synchronous ([[src/core/engines/kinematics/index.ts]]): spanning tree from the grounded instances, Levenberg–Marquardt for loops, limits clamp ([[Architecture/Decisions#ADR-20]]). Joint types and their degrees of freedom: `jointDofs` in [[src/core/contracts/assembly.ts]]. Motion links set driven freedoms before solving: linear ones by a ratio, cams by their profile (`linkedValue`). |
| **Interchange** | `exportDrawing(sketch, 'dxf' \| 'svg', kerf?) → Uint8Array` (with `kerf`, profile outlines move half a kerf away from the part); `exportBodies(bodies, format)`, each body optionally placed by a transform (assemblies: one named solid or object per instance); `readSolids(bytes, format, key, parts?)` (STEP, KiCad boards with their parts' STEP models, and meshes up to 100,000 triangles after a repair, into Shape Access); `readMesh(bytes, format, key, parts?)` (display meshes of any size; a board with its holes and parts); `simplifyMesh(bytes, format, triangles, key)` (a mesh repaired and decimated, as a new file with a preview); `partFiles(bytes, format)` (the models a board names); `readDrawing(bytes, 'dxf' \| 'svg', idPrefix)` (sketch entities); `convert(bytes, from, to)` | DXF: ASCII with R12 entities (LINE, CIRCLE, ARC) and `$INSUNITS` set to mm. SVG: sized in mm, Y up, hairline strokes, no fill, which is what laser software expects. Construction geometry is left out. STEP goes through OCCT; STL, OBJ and 3MF are written in TypeScript. One writer per format, in a registry. |
| **Plugin** | `read(source) → Result<ProjectPlugin>` (a plugin's description, checked: id, version, plugin API, parts and parameters); `build(plugin, feature, values) → Result<PluginSolid[]>` (outlines in a plane with holes, a height and a `z`; cached by plugin, version and values); `export(plugin, exporter, model) → Result<string>` | Runs the plugin's own JavaScript in the Sandbox utility ([[src/core/engines/plugin/index.ts]], [[Architecture/Decisions#ADR-60a]]). The Design Manager builds a plugin feature's solids with ordinary extrudes and joins the solids of a new body; the Project Manager installs plugins into projects. |

## Resource Access

Atomic business verbs over a resource. Implementations vary by host and are chosen in the composition root.

| Resource Access | Contract | Browser | Desktop |
| --- | --- | --- | --- |
| **Project Access** | `enumerate`, `find`, `establish`, `revise`, `discard` projects | IndexedDB | `projects/<id>/project.json` |
| **Document Access** | `load(id)` (migrates schema on read), `store(doc)`, `discard(id)`, `enumerate(projectId)` | IndexedDB | `projects/<id>/documents/<docId>.json` |
| **Asset Access** | `keep(asset)`, `fetch(assetId)`, `release(assetId)`; `publishResult({ documentId, projectId, stamp, bytes })`, `latestResult(documentId)`, `discardResult(documentId)` | IndexedDB blobs | `projects/<id>/assets/*`, `projects/<id>/results/*` |
| **Version Access** | `record(files, message, time, mergeOf?)`, `versions(path?)` (with `shared` once a remote was fetched), `latest`, `read`/`readBytes`, `files`, `commonVersion`, `advance`, `name`/`unname`, `discard`, `exportHistory`/`importHistory`; `fetch(remote, credentials?)`, `push(remote, credentials?)`, `syncNames(remote, credentials?)` ([[src/core/access/version/version-access.ts]]) | a bare git repository per project (isomorphic-git) on an IndexedDB file system | the same in `projects/<id>/.git` |
| **Server Access** | `info`, `signInByName`, `user`, `signOut`, `projects`, `createProject`, `project`, `setMember`, `removeMember`, `addLink`, `removeLink`, `link`; `join(room, listener)` → a live connection (`send`, `present`, `snapshot`, `reconnect`, `close`) that reconnects by itself ([[src/core/access/server/server-access.ts]]) | `fetch` to a CADence server ([[Architecture/Server]]); the relay's server-sent events read from the response stream | same |
| **Shape Access** | `ready()` (loads OCCT once), `put(key, named shape)`, `get(key)`, `has(key)`; `find(named, ref)` resolves a persistent reference to its face or edge; `place(shape, transform)` makes a moved copy. OCCT loads once per thread | in-worker OCCT shapes with their face and edge names; least recently used ones are evicted and their memory freed | same |
| **External File Access** | `deliver(bytes, suggestedName)` (exports) | download | Tauri dialog and fs plugins |

> [!NOTE]
> Choosing a file to import needs a user gesture, so the **client** shows the picker (or accepts a drop) and passes the file's name and bytes to the Project Manager as an `ExternalFile`. External File Access only delivers files *out* of the app.

## Utilities

Utilities are generic enough to be used by any system.

| Utility | Purpose |
| --- | --- |
| **Messaging** | Typed request/response RPC over `postMessage` with transferables; in-process typed event bus used for queued manager events. |
| **Diagnostics** | Structured logging, performance marks and measures, error reporting. |
| **Math and Units** | Vectors, line and circle intersections, polygon area and containment, loop offsetting (kerf), fitting lines and arcs to points, rigid 4 × 4 transforms (column-major, as three.js). |
| **Text** | The bundled font (Inter, regular and bold) loaded once per weight, and text laid out as outlines: lines and cubic Béziers at a given cap height, position and angle. |
| **Identity** | Id generation and content hashing (used for caching). |
| **Sandbox** | Runs JavaScript others wrote (scripts, plugins) in QuickJS compiled to WebAssembly, with only the globals given to it, a memory and a time limit, calls out to a host as JSON, and Stop; `workerSandbox` and `serveSandbox` run each script in a worker of its own ([[src/core/utilities/sandbox/index.ts]], [[Architecture/Decisions#ADR-60]]). |
| **Viewer and Scene** | A model (parts with meshes, colours and transforms) as one self-contained HTML viewer, as binary glTF or as USDZ, at real size in metres with Y up ([[Architecture/Decisions#ADR-33]], [[Architecture/Decisions#ADR-62]]). |
| **Picture and Raster** | PNG and JPEG reading, PNG and animated GIF writing, tracing outlines; a software renderer (depth buffer, shading, edges, framing chosen meshes, see-through meshes) for pictures without a GPU. |
