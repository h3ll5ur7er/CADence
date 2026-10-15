# Components

The responsibilities and service contracts of every component in [[Architecture]]. The contracts below are *design-level*. The source of truth is each component's `index.ts` in `src/core`. Operations are business verbs, not CRUD, and every engine and manager operation is async (see [[Architecture#Deployment and threads]]).

[TOC]

## Clients

| Client | Responsibility |
| --- | --- |
| **Home** | Lists projects with their documents and thumbnails; creates, renames, deletes and opens projects and documents; imports files. |
| **Editor shell** | Routes to the mode matching the document kind; hosts toolbars, the feature/document tree, the properties panel and the viewport. |
| **Component editor** | Sketch tools, feature dialogs, timeline, parameters table, measure and validation panels. Translates user gestures into **Design commands**. |
| **Assembly editor** | Instance tree, joint tools, motion-study timeline and playback. Translates gestures into **Assembly commands**. |
| **Imported viewer** | Shows imported geometry and metadata; offers conversion and export. |
| **Viewport** | three.js scene: renders mesh DTOs, picks faces/edges/vertices by their persistent ids, camera navigation, view cube, grid. Pure presentation. |
| **Desktop shell** | The Tauri app hosting the web client; exposes the native file system and dialogs as IPC commands used by Resource Access. |

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
}
```

Imported documents keep their original file; their summaries carry the `format`, so lists can tell drawings from 3D files.

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
  properties(): Promise<BodyProperties[]>;  // volume, area, mass (document material), centre of mass, box
  validate(): Promise<ValidationReport>;    // the document's manufacturing profile against bodies and sketches
}
```

`DesignCommand` is a discriminated union, and the caller supplies the ids of new elements. The commands:

- **Sketches:** `create-sketch` (on any `PlaneRef`), `add-sketch-geometry`, `add-constraint`, `set-dimension`, `move-point`, `toggle-construction`, `delete-sketch-elements`.
- **Features:** `add-feature`, `edit-feature`.
- **Timeline items:** `suppress-item`, `rename-item`, `delete-item`.
- **Parameters:** `add-parameter`, `set-parameter`, `delete-parameter`.
- **Manufacturing:** `set-material` (name and density), `set-process` (a printer or laser profile); both are validated (sizes above zero) and undoable ([[Architecture/Decisions#ADR-19]]).

The state also carries each item's status (ok, error with reason, suppressed), construction planes, body meshes and evaluated parameters.

**A command is atomic.** The manager applies it to a copy of the document (pure functions in [[src/core/managers/design/commands.ts]]), evaluates the sketch's dimension expressions and solves the sketch. It **rejects** the command and leaves the document untouched in three cases:

- an expression is invalid;
- constraints conflict (the message names the constraint kinds involved);
- the result would collapse a line, circle or arc to nothing. For example, horizontal *and* vertical on one line is something the solver could satisfy, but only by shrinking the line to zero length.

Accepted commands are saved immediately and pushed onto the undo history (state snapshots, up to 200). Commands run one at a time, so fast input such as drags never interleaves.

**Regeneration workflow** (owned by this manager only): evaluate parameters, then walk the timeline up to the rollback marker. For a sketch, resolve its plane through the Modeling Engine and then solve it through the Sketch Engine. For a feature, apply it through the Modeling Engine. Engines cache by content hash, so only items downstream of a change are recomputed.

**Publishing results.** After a successful regeneration at the end of the timeline, the manager snapshots the bodies (Modeling Engine `snapshotBodies`: OCCT B-rep, mesh and topology names) and keeps them as the document's **component result** through Asset Access, keyed by the document's content hash. Assemblies and exports of whole projects consume this result instead of regenerating the component themselves.

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
  interference(): Promise<Interference[]>;
  exportAssembly(format: 'step' | 'stl' | 'obj' | '3mf'): Promise<Result<void>>;
  saveRecording(bytes, studyName): Promise<void>;                  // recorded video, through External File Access
  close(): void;
}
```

Instances can be components or imported 3D files (read once per original). Commands: `insert-instance`, `remove-instance` (with its joints and their keys), `rename-instance`, `move-instance` (refused for instances a joint places), `ground-instance`, `add-joint`, `edit-joint`, `remove-joint`, `set-joint-values`, `add-study`, `edit-study`, `remove-study`. A joint command is refused when its joint cannot hold.

The Assembly Manager never regenerates a component. It restores each instance from the component's **published result** (Asset Access → Modeling Engine `restore` + `tessellate`). When a result is missing or stale, it queues `regenerateComponent` to the Design Manager and reloads the component on `componentRegenerated` ([[Architecture/Decisions#ADR-11]]). It also follows `documentRenamed` and `documentDeleted` (a deleted component shows as missing). Joint frames come from the Modeling Engine (`frameOf`, cached per component version); positions from the Kinematics Engine.

## Engines

Engines encapsulate the volatility of an *activity*: an algorithm or a set of business rules. They are stateless apart from caches, and they never call other engines.

| Engine | Contract (core operations) | Implementation notes |
| --- | --- | --- |
| **Parameter** | `evaluate(expression, kind, scope) → Result<number>` (mm, radians); later `evaluate(parameters)` with dependency ordering | Own recursive-descent parser: arithmetic, `^`, functions (`sin`, `sqrt`, `min`, …), constants, names from the scope, and units (`mm cm m in ft`, `deg rad`) with dimensional analysis. Plain numbers are read as mm or degrees. It is pure and fast, so it is the one **synchronous** engine. |
| **Sketch** | `solve(sketch, values, drag?) → SketchSolution`: solved geometry, status (under / fully / over-constrained / failed), degrees of freedom, conflicting constraint ids, profiles; pure editing functions `trim`, `extend`, `split`, `offset`, `fillet`, `chamfer` → a `SketchEdit` ([[Architecture/Decisions#ADR-25]]) | planegcs (WASM, loaded lazily on the first solve). Drags pull a point with temporary constraints. For profiles, curves are split at intersections and faces are traced in the planar graph (tangent and curvature order at each vertex). Areas are exact (with circular-segment corrections), and islands become holes. Profile ids derive from the bounding curves, so they survive dimension changes. |
| **Modeling** | `apply(request) → { bodies, toolKey?, error? }` for extrude, revolve, fillet, chamfer, shell, linear/circular pattern, mirror; `planeOf(bodies, face) → PlaneFrame`; `tessellate(bodies) → BodyMesh[]`; `frameOf(bodies, ref)` (joint frames, [[Architecture/Decisions#ADR-21]]); `snapshot(bodies) → bytes` and `restore(bytes, prefix)` (component results: B-rep text plus names in topological order) | OCCT (`replicad-opencascadejs`, through `replicad`) in the geometry worker. Generative naming ([[Architecture/Decisions#ADR-15]]); results validated with `BRepCheck_Analyzer`; outcomes cached by request content hash. |
| **Analysis** | `measure(bodies, refs) → Result<Measurement>`; `properties(bodies, density) → BodyProperties[]`; `validate({ bodies, sketches }, profile) → Check[]` | In the geometry worker ([[src/core/engines/analysis/index.ts]]). Measures and mass properties with OCCT (`BRepExtrema_DistShapeShape`, `GProp`). **Print rules:** closed valid solid, build volume (also turned by 90°), overhangs steeper than the profile allows (bed contact excluded), wall thickness by ray casting (fail below one nozzle width, warn below two). **Laser rules:** body thickness = sheet, closed outlines, laser bed, kerf compensation possible. Each check names the faces it is about. TypeScript on cached meshes ([[Architecture/Decisions#ADR-18]]). `interference(placed parts)`: OCCT common of every overlapping pair (bounding boxes first), touching is not interference. |
| **Kinematics** | `solve(model, driven?) → { poses, values, placed, error? }`; `simulate(model, study, fps) → { frames, error? }` | Pure TypeScript, synchronous ([[src/core/engines/kinematics/index.ts]]): spanning tree from the grounded instances, Levenberg–Marquardt for loops, limits clamp ([[Architecture/Decisions#ADR-20]]). Joint types and their degrees of freedom: `jointDofs` in [[src/core/contracts/assembly.ts]]. |
| **Interchange** | `exportDrawing(sketch, 'dxf' \| 'svg', kerf?) → Uint8Array` (with `kerf`, profile outlines move half a kerf away from the part); `exportBodies(bodies, format)`, each body optionally placed by a transform (assemblies: one named solid or object per instance); `readSolids(bytes, format, key)` (STEP, and meshes up to 100,000 triangles, into Shape Access); `readMesh(bytes, format, key)` (display meshes of any size); `readDrawing(bytes, 'dxf' \| 'svg', idPrefix)` (sketch entities); `convert(bytes, from, to)` | DXF: ASCII with R12 entities (LINE, CIRCLE, ARC) and `$INSUNITS` set to mm. SVG: sized in mm, Y up, hairline strokes, no fill, which is what laser software expects. Construction geometry is left out. STEP goes through OCCT; STL, OBJ and 3MF are written in TypeScript. One writer per format, in a registry. |

## Resource Access

Atomic business verbs over a resource. Implementations vary by host and are chosen in the composition root.

| Resource Access | Contract | Browser | Desktop |
| --- | --- | --- | --- |
| **Project Access** | `enumerate`, `find`, `establish`, `revise`, `discard` projects | IndexedDB | `projects/<id>/project.json` |
| **Document Access** | `load(id)` (migrates schema on read), `store(doc)`, `discard(id)`, `enumerate(projectId)` | IndexedDB | `projects/<id>/documents/<docId>.json` |

> [!NOTE]
> Choosing a file to import needs a user gesture, so the **client** shows the picker (or accepts a drop) and passes the file's name and bytes to the Project Manager as an `ExternalFile`. External File Access only delivers files *out* of the app.
| **Asset Access** | `keep(asset)`, `fetch(assetId)`, `release(assetId)`; `publishResult({ documentId, projectId, stamp, bytes })`, `latestResult(documentId)`, `discardResult(documentId)` | IndexedDB blobs | `projects/<id>/assets/*`, `projects/<id>/results/*` |
| **Shape Access** | `ready()` (loads OCCT once), `put(key, named shape)`, `get(key)`, `has(key)`; `find(named, ref)` resolves a persistent reference to its face or edge; `place(shape, transform)` makes a moved copy. OCCT loads once per thread | in-worker OCCT shapes with their face and edge names; least recently used ones are evicted and their memory freed | same |
| **External File Access** | `deliver(bytes, suggestedName)` (exports) | download | Tauri dialog and fs plugins |

## Utilities

Utilities are generic enough to be used by any system.

| Utility | Purpose |
| --- | --- |
| **Messaging** | Typed request/response RPC over `postMessage` with transferables; in-process typed event bus used for queued manager events. |
| **Diagnostics** | Structured logging, performance marks and measures, error reporting. |
| **Math and Units** | Vectors, line and circle intersections, polygon area and containment, loop offsetting (kerf), rigid 4 × 4 transforms (column-major, as three.js). |
| **Identity** | Id generation and content hashing (used for caching). |
