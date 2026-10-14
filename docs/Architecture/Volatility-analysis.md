# Volatility analysis

The components in [[Architecture]] come from asking two questions. What will change **for one user over time**? And what differs **between users at the same time**? Each answer that could hurt the design if it were spread across the code gets a component that encapsulates it.

## Areas of volatility

| # | Volatility | What changes | Encapsulated in |
| --- | --- | --- | --- |
| 1 | **Client and host** | Browser today, desktop (Tauri) too; later a scripting API, CLI or headless automation. Screens and interaction styles change constantly. | Clients (Angular app, Desktop shell) |
| 2 | **Project workflow** | How projects and documents are created, duplicated, imported, organized, later versioned or shared. | Project Manager |
| 3 | **Part-design workflow** | The sequence of editing a component: sketch → feature, edit in the past (rollback), regeneration, undo/redo, autosave, validation on change. | Design Manager |
| 4 | **Assembly workflow** | Inserting components, mating them, solving, motion studies and animation. | Assembly Manager |
| 5 | **Constraint solving** | New constraint types, solver algorithm, degrees-of-freedom diagnostics, conflict reporting. | Sketch Engine |
| 6 | **Modeling operations** | The feature catalog keeps growing (extrude, revolve, sweep, loft, fillet, chamfer, shell, draft, patterns, mirror, booleans), and so does how references to topology survive edits. | Modeling Engine |
| 7 | **Parametrics** | Expression language, functions, units, variable scopes, dependency evaluation. | Parameter Engine |
| 8 | **Kinematics** | Joint types, solver, limits, drivers, simulation and collision detection. | Kinematics Engine |
| 9 | **Analysis and validation rules** | Measurements, mass properties; printability rules depend on the process (FDM, SLA, laser) and the machine. | Analysis Engine |
| 10 | **Exchange formats** | STEP (AP214/AP242), STL, OBJ, 3MF, DXF, SVG, and formats users will ask for next. | Interchange Engine |
| 11 | **Storage medium** | IndexedDB in the browser, a folder on disk on desktop; later perhaps cloud or git sync. | Project Access, Document Access, Asset Access |
| 12 | **Document schema** | The persisted model evolves with every new feature. | Document Access (migrates on read) |
| 13 | **Geometry kernel and shape lifetime** | OCCT today; what is cached, for how long, and in which thread. | Shape Access (over the in-worker shape cache) + Modeling Engine |
| 14 | **Execution placement** | Main thread, Web Worker, WASM, native Rust in Tauri. | Async engine interfaces + Messaging utility |
| 15 | **Host file exchange** | Browser download vs native save dialog, file picker vs drag and drop vs OS "open with". | External File Access |
| 16 | **Rendering technology** | WebGPU / WebGL, picking strategy, visual styles. | Viewport (client side), insulated by the mesh DTO contract |

## Deliberately not encapsulated (yet)

- **Users, authentication, permissions**: out of scope for now. A Security utility and a check in each manager can be added without restructuring.
- **Real-time collaboration**: not planned. Documents are changed only through **commands**, which keeps an operation-based sync possible later.
- **A second geometry kernel**: unlikely. The kernel is still hidden behind the engines and Shape Access, so no client or manager knows about OCCT.

## Checks on the decomposition

- **Each functional requirement becomes an interaction, not a component.** "Export STL" is Design Manager → Interchange Engine → External File Access, and "export DXF of a sketch" uses the same components with other data. See [[Architecture/Use cases and call chains]].
- **Engines are reused across managers.** Modeling, Analysis and Interchange each serve two or three managers, which shows they encapsulate activities and not use cases.
- **There are few managers.** Three managers cover all core use cases. Adding laser-cut nesting or slicing later would be a new engine called by an existing manager, or at most a fourth manager.
