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

A session-based manager for one component document. **All edits are commands**, which gives undo/redo, autosave and later collaboration from one mechanism.

```ts
interface DesignManager {
  open(documentId: DocumentId): Promise<DesignSession>;
}
interface DesignSession {
  readonly state$: Observable<DesignState>;       // document, regen results, meshes, diagnostics
  execute(command: DesignCommand): Promise<CommandResult>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  measure(selection: TopologyRef[]): Promise<Measurement>;
  validate(profile: ManufacturingProfile): Promise<ValidationReport>;
  exportBodies(format: SolidExportFormat, options?: ExportOptions): Promise<void>;  // 'step' | 'stl' | 'obj' | '3mf'
  exportSketch(sketchId: SketchId, format: DrawingExportFormat): Promise<void>;     // 'dxf' | 'svg'
  close(): Promise<void>;
}
```

`DesignCommand` is a discriminated union: `addSketch`, `editSketch` (with sketch operations), `addFeature`, `editFeature`, `deleteItem`, `reorderItem`, `suppressItem`, `rollTo`, `setParameter`, `addParameter`, and so on.

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
| **Parameter** | `evaluate(parameters) → ParameterValues \| errors`; `evaluateExpression(expr, scope)` | Own expression parser (units, math functions, references), dependency-graph ordering, cycle detection. |
| **Sketch** | `solve(sketch, values, externalGeometry) → SolvedSketch` (geometry, DOF, status: under / fully / over-constrained / conflicting, conflicting constraint ids); `findProfiles(solved) → Profile[]` | planegcs (WASM). Profile (closed region) detection by a planar graph walk. |
| **Modeling** | `resolvePlane(planeRef) → Plane`; `applyFeature(feature, inputs) → FeatureResult` (body keys, topology map, errors); `tessellate(bodyKeys, quality) → MeshDTO[]`; `snapshotBodies(keys) → bytes`; `restoreBodies(bytes, placement) → keys` | OCCT in the geometry worker. Persistent naming via OCCT generation history (see [[Architecture/Document model#Persistent references]]). |
| **Analysis** | `measure(refs)`; `massProperties(bodyKey, density)`; `checkManufacturability(bodyKey, profile) → ValidationReport` | Geometric checks with OCCT; mesh-based printability checks (overhang, thin walls) are Rust/WASM candidates. |
| **Kinematics** | `solve(assemblyModel, drivers) → InstanceTransforms`; `step(state, dt)` | Joint graph and constraint solver (Newton-Raphson on joint equations); rigid body motion first. |
| **Interchange** | `export(source, format, options) → Uint8Array`; `import(bytes, format) → ImportResult` | STEP through OCCT; STL, OBJ, 3MF, DXF, SVG writers and readers in TypeScript. A format registry keeps adding a format a local change. |

## Resource Access

Atomic business verbs over a resource. Implementations vary by host and are chosen in the composition root.

| Resource Access | Contract | Browser | Desktop |
| --- | --- | --- | --- |
| **Project Access** | `enumerate`, `find`, `establish`, `revise`, `discard` projects | IndexedDB | `projects/<id>/project.json` |
| **Document Access** | `load(id)` (migrates schema on read), `store(doc)`, `discard(id)`, `enumerate(projectId)` | IndexedDB | `projects/<id>/documents/<docId>.json` |

> [!NOTE]
> Choosing a file to import needs a user gesture, so the **client** shows the picker (or accepts a drop) and passes the file's name and bytes to the Project Manager as an `ExternalFile`. External File Access only delivers files *out* of the app.
| **Asset Access** | `keep(bytes, meta) → AssetId`, `fetch(assetId)`, `release(assetId)`; `publishResult(documentId, hash, bytes)`, `latestResult(documentId)` | IndexedDB blobs | `projects/<id>/assets/*`, `projects/<id>/results/*` |
| **Shape Access** | `put(key, shape)`, `get(key)`, `evict(keys)`, `retainOnly(keys)` | in-worker OCCT shape cache | same |
| **External File Access** | `deliver(bytes, suggestedName)` (exports) | download | Tauri dialog and fs plugins |

## Utilities

Utilities are generic enough to be used by any system.

| Utility | Purpose |
| --- | --- |
| **Messaging** | Typed request/response RPC over `postMessage` with transferables; in-process typed event bus used for queued manager events. |
| **Diagnostics** | Structured logging, performance marks and measures, error reporting. |
| **Math and Units** | Vectors, matrices, transforms, tolerances, unit conversion. |
| **Identity** | Id generation and content hashing (used for caching). |
