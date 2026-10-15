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
  importFile(projectId: ProjectId, source: ExternalFileRef): Promise<DocumentSummary>;
  openImported(documentId: DocumentId): Promise<ImportedView>;
  exportImported(documentId: DocumentId, format: ExportFormat): Promise<void>;
}
```

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
  exportSketch(sketchId, format: 'dxf' | 'svg'): Promise<Result<void>>;
  exportBodies(format: 'step' | 'stl' | 'obj' | '3mf'): Promise<Result<void>>;
  volumes(): Promise<Record<string, number>>;  // mm³ per body
  // later: measure, validate
}
```

`DesignCommand` is a discriminated union, and the caller supplies the ids of new elements. The commands:

- **Sketches:** `create-sketch` (on any `PlaneRef`), `add-sketch-geometry`, `add-constraint`, `set-dimension`, `move-point`, `toggle-construction`, `delete-sketch-elements`.
- **Features:** `add-feature`, `edit-feature`.
- **Timeline items:** `suppress-item`, `rename-item`, `delete-item`.
- **Parameters:** `add-parameter`, `set-parameter`, `delete-parameter`.

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

```ts
interface AssemblyManager {
  open(documentId: DocumentId): Promise<AssemblySession>;
}
interface AssemblySession {
  readonly state$: Observable<AssemblyState>;
  execute(command: AssemblyCommand): Promise<CommandResult>;  // insertInstance, addJoint, setDriver, ...
  undo(): Promise<void>;
  redo(): Promise<void>;
  simulate(studyId: MotionStudyId): AsyncIterable<MotionFrame>;
  checkInterference(): Promise<InterferenceReport>;
  export(format: ExportFormat): Promise<void>;
  close(): Promise<void>;
}
```

The Assembly Manager never regenerates a component. It restores each instance from the component's **published result** (Asset Access → Modeling Engine `restoreBodies`). When a result is missing or stale, it queues `RegenerateComponent` to the Design Manager and updates the instance on `ComponentRegenerated`.

## Engines

Engines encapsulate the volatility of an *activity*: an algorithm or a set of business rules. They are stateless apart from caches, and they never call other engines.

| Engine | Contract (core operations) | Implementation notes |
| --- | --- | --- |
| **Parameter** | `evaluate(expression, kind, scope) → Result<number>` (mm, radians); later `evaluate(parameters)` with dependency ordering | Own recursive-descent parser: arithmetic, `^`, functions (`sin`, `sqrt`, `min`, …), constants, names from the scope, and units (`mm cm m in ft`, `deg rad`) with dimensional analysis. Plain numbers are read as mm or degrees. It is pure and fast, so it is the one **synchronous** engine. |
| **Sketch** | `solve(sketch, values, drag?) → SketchSolution`: solved geometry, status (under / fully / over-constrained / failed), degrees of freedom, conflicting constraint ids, profiles | planegcs (WASM, loaded lazily on the first solve). Drags pull a point with temporary constraints. For profiles, curves are split at intersections and faces are traced in the planar graph (tangent and curvature order at each vertex). Areas are exact (with circular-segment corrections), and islands become holes. Profile ids derive from the bounding curves, so they survive dimension changes. |
| **Modeling** | `apply(request) → { bodies, toolKey?, error? }` for extrude, revolve, fillet, chamfer, shell, linear/circular pattern, mirror; `planeOf(bodies, face) → PlaneFrame`; `tessellate(bodies) → BodyMesh[]`; `volumes(bodies)`; later `snapshotBodies`, `restoreBodies` | OCCT (`replicad-opencascadejs`, through `replicad`) in the geometry worker. Generative naming ([[Architecture/Decisions#ADR-15]]); results validated with `BRepCheck_Analyzer`; outcomes cached by request content hash. |
| **Analysis** | `measure(refs)`; `massProperties(bodyKey, density)`; `checkManufacturability(bodyKey, profile) → ValidationReport` | Geometric checks with OCCT; mesh-based printability checks (overhang, thin walls) are Rust/WASM candidates. |
| **Kinematics** | `solve(assemblyModel, drivers) → InstanceTransforms`; `step(state, dt)` | Joint graph and constraint solver (Newton-Raphson on joint equations); rigid body motion first. |
| **Interchange** | `exportDrawing(sketch, 'dxf' \| 'svg') → Uint8Array`; later `export(bodies, format)` and `import(bytes, format)` | DXF: ASCII with R12 entities (LINE, CIRCLE, ARC) and `$INSUNITS` set to mm. SVG: sized in mm, Y up, hairline strokes, no fill, which is what laser software expects. Construction geometry is left out. STEP goes through OCCT; STL, OBJ and 3MF are written in TypeScript. One writer per format, in a registry. |

## Resource Access

Atomic business verbs over a resource. Implementations vary by host and are chosen in the composition root.

| Resource Access | Contract | Browser | Desktop |
| --- | --- | --- | --- |
| **Project Access** | `enumerate`, `find`, `establish`, `revise`, `discard` projects | IndexedDB | `projects/<id>/project.json` |
| **Document Access** | `load(id)` (migrates schema on read), `store(doc)`, `discard(id)`, `enumerate(projectId)` | IndexedDB | `projects/<id>/documents/<docId>.json` |

> [!NOTE]
> Choosing a file to import needs a user gesture, so the **client** shows the picker (or accepts a drop) and passes the file's name and bytes to the Project Manager as an `ExternalFile`. External File Access only delivers files *out* of the app.
| **Asset Access** | `keep(bytes, meta) → AssetId`, `fetch(assetId)`, `release(assetId)`; `publishResult(documentId, hash, bytes)`, `latestResult(documentId)` | IndexedDB blobs | `projects/<id>/assets/*`, `projects/<id>/results/*` |
| **Shape Access** | `ready()` (loads OCCT once), `put(key, named shape)`, `get(key)`, `has(key)` | in-worker OCCT shapes with their face and edge names; least recently used ones are evicted and their memory freed | same |
| **External File Access** | `deliver(bytes, suggestedName)` (exports) | download | Tauri dialog and fs plugins |

## Utilities

Utilities are generic enough to be used by any system.

| Utility | Purpose |
| --- | --- |
| **Messaging** | Typed request/response RPC over `postMessage` with transferables; in-process typed event bus used for queued manager events. |
| **Diagnostics** | Structured logging, performance marks and measures, error reporting. |
| **Math and Units** | Vectors, matrices, transforms, tolerances, unit conversion. |
| **Identity** | Id generation and content hashing (used for caching). |
