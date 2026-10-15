# Decisions

Architecture decision records. Each one records what was decided, why, and what we gave up. Add new ones at the end, and mark an ADR as *superseded* instead of deleting it.

[TOC]

## ADR-1

**iDesign with test-enforced layers.** The system is decomposed by volatility into Clients, Managers, Engines, Resource Access, Resources and Utilities ([[Architecture]]). The call rules are enforced by an architecture test over the real import graph ([[tools/architecture/rules.ts]]), so violations fail `npm test` rather than a review. This replaced the first plan of using `eslint-plugin-boundaries`, whose v7 configuration API changed completely; a ~100-line checker with its own tests is easier to trust.
*Trade-off:* more interfaces and a composition root up front. In return, features (new feature types, formats, hosts) land in one component.

## ADR-2

**OCCT as the B-rep kernel, via `replicad-opencascadejs`.** It is the only mature open-source B-rep kernel that runs in WASM, with booleans, fillets, chamfers, shell, sweeps, lofts and native STEP read/write. `replicad-opencascadejs` is a maintained, trimmed OCCT build (LGPL-2.1, last released 2026-09). The `replicad` library (MIT) may be used *inside* engines as a convenience layer and is never exposed beyond them. The kernel runs in a Web Worker.
*Trade-off:* a large download (tens of MB, cached by the service worker on the web ([[Architecture/Decisions#ADR-23]]), bundled on desktop) and LGPL obligations: we ship the WASM unmodified and dynamically loaded, and we credit it in the About dialog. Rejected: Truck (Rust; immature fillets, partial STEP), Manifold (mesh only; no true STEP or fillets).

## ADR-3

**planegcs for sketch constraints.** This is FreeCAD's geometric constraint solver compiled to WASM (`@salusoft89/planegcs`, LGPL). It is battle-tested, reports DOF and conflicts, and covers every constraint type we need.
*Trade-off:* LGPL, handled as in ADR-2. Writing our own solver would cost months to reach parity.

## ADR-4

**Tauri 2 for the desktop.** It gives small binaries, a Rust backend that matches our Rust/WASM toolchain, and native file system and dialogs through plugins.
*Trade-off:* it uses the system WebView, so WebGPU availability varies (WebView2 on Windows supports it). The viewport falls back to WebGL2 (ADR-6). Tauri IPC is unavailable in Web Workers, so storage access stays on the main thread ([[Architecture#Deployment and threads]]).

## ADR-5

**IndexedDB in the browser; a project folder on desktop.** IndexedDB works on every browser and on the main thread; each Resource Access owns its own database. On desktop, a project is a human-readable folder (`project.json`, `documents/*.json`, `assets/*`) that the user can back up or put under git, below the app data folder (`%APPDATA%/dev.cadence.app/projects` on Windows). The folder implementations work on a small `FileSystem` port, which Tauri implements in the app and Node implements in tests, so they pass the same contract tests as IndexedDB.
*Trade-off:* OPFS would be faster for large blobs. We will add it behind Asset Access if imports get big (YAGNI until then).

## ADR-6

**three.js `WebGPURenderer` with automatic WebGL2 fallback.** It is mature, its WebGPU backend is production-ready, it falls back to WebGL2 by itself, and it offers TSL for custom shading (edges, section views, zebra stripes). Picking uses persistent topology ids attached to mesh ranges.
*Trade-off:* not a hand-written WebGPU engine. That was rejected as unjustified effort; three's renderer is encapsulated in the Viewport client component.

## ADR-7

**Angular 22, modern style.** The client uses standalone components, zoneless change detection, signals and `computed`/`linkedSignal`/`resource` for UI state, `OnPush`, the built-in control flow, deferrable views (`@defer`) for heavy editor panels, signal forms for dialogs, and lazy-loaded routes per editor mode. The viewport renders outside Angular's change detection on `requestAnimationFrame`, only while dirty.

## ADR-8

**Speed-ups only where they pay.** The heavy compute is already native code compiled to WASM (OCCT, planegcs). Rust/WASM (`wasm-bindgen`, `wasm-pack`) is introduced **behind an engine interface** when profiling shows a TypeScript hotspot. The first candidates are mesh-based printability analysis (overhangs, wall thickness), very large mesh import and decimation, and the kinematics solver. Hot paths use transferable typed arrays and never copy meshes between threads.
*Trade-off:* no Rust "for its own sake". Each Rust module needs a benchmark proving its benefit.

## ADR-9

**Test strategy.** TDD with Vitest for `src/core`: engines and managers run headless in Node (OCCT and planegcs load in Node), managers are tested against in-memory Resource Access fakes, and Resource Access gets contract tests run against every implementation. Angular components use Vitest component tests. Playwright runs end-to-end flows on the browser build and produces the **screenshots used as phase evidence** ([[Conventions#Definition of done]]).

## ADR-10

**Commands as the only way to change a document.** Every edit is a serializable command applied by a manager. This gives undo/redo, autosave, an audit trail and a future path to collaboration from a single mechanism, and keeps clients free of domain logic.

## ADR-11

**Assemblies consume published component results.** Only the Design Manager knows how to regenerate a component. After each full regeneration it publishes the result (B-rep, mesh, topology names) through Asset Access. The Assembly Manager restores instances from that result and asks for a fresh one with a *queued* `RegenerateComponent` request.
*Why:* it keeps the regeneration workflow in one manager (DRY) without a synchronous manager-to-manager call, and opening a large assembly no longer regenerates every part.
*Trade-off:* results are caches that can go stale, so they are validated on use. Per-instance parameter overrides (configurations) will need a variant key on the request when they arrive.
*As built (phase 5):* a result is stamped with the component's `modifiedAt` rather than a content hash, since that is what both managers can see without sharing code. The Design Manager publishes after every change (re-using the snapshot while the bodies are unchanged) and answers `regenerateComponent` with `componentRegenerated`. An Assembly session asks again, up to three times, when the answer is already stale because the component changed meanwhile.

## ADR-12

**The sketch editor is an SVG overlay on the 3D viewport.** While a sketch is edited, the camera looks straight at its plane and rotation is locked (pan and zoom still work). The plane-to-screen mapping is then an exact similarity transform, so curves are drawn in sketch millimetres inside one `<g transform="matrix(…)">`. Points, constraint glyphs and dimension labels are drawn in pixels. The 3D scene shows finished sketches as lines and shaded profiles.
*Why:* crisp, constant-width strokes, text labels and DOM hit-testing for free, no picking code, and it is easy to test. The three.js scene stays a pure renderer.
*Trade-off:* sketches are edited head-on only, like in most CAD tools.

## ADR-13

**Changes that leave a sketch inconsistent are refused, not stored.** A command whose sketch would be over-constrained, unsolvable or degenerate (a curve collapsing to nothing) is rejected with a message, and the document stays as it was.
*Why:* the user learns immediately which relation conflicts, and the document is never in a broken state that later features would build on.
*Trade-off:* an over-constrained sketch can only be reached by editing a stored file by hand. On open such a sketch shows as "Does not solve" instead of failing the editor.

## ADR-14

**planegcs loads lazily.** The solver's JavaScript and WebAssembly load on the first solve (dynamic `import()`), and the WebAssembly is served from `/wasm/` (copied by `angular.json` assets). The Emscripten loader's Node-only `import("node:module")` is marked external for the browser build.
*Why:* the home page stays small (84 kB transferred at start).

## ADR-15

**Generative naming by surface identity.** Persistent references name faces by the feature and role that created them, and inherit names through later features by *surface identity*: a face on the same plane, cylinder, cone, sphere or torus as an earlier face keeps its name ([[Architecture/Document model#Persistent references]]).
*Why:* OCCT's own history (`Generated`/`Modified`) is not exposed through replicad. Surface identity is exact for the prismatic and turned parts people print and cut, and it survives booleans and trims.
*Trade-off:* freeform (B-spline) faces only match by centre and area, so their names are less stable. References that cannot be resolved fail loudly instead of re-binding.
*Later:* freeform faces match by their surface, and loft, sweep and draft faces are named from the kernel's history ([[#ADR-28]]).

## ADR-16

**One geometry worker, engines behind typed RPC, results validated.** The Modeling, Interchange and Analysis engines run in a dedicated Web Worker with their own Shape Access (an LRU cache of OCCT solids that frees WebAssembly memory). The main thread calls them through `remote<T>()` proxies ([[src/core/utilities/messaging/rpc.ts]]); meshes travel as transferable typed arrays. Every feature result is checked with OCCT's `BRepCheck_Analyzer`, and a shell that leaves the solid unchanged is reported as an error.
*Why:* the UI never blocks on the kernel, and kernel failures become messages instead of broken bodies.
*Trade-off:* every regeneration costs a few round trips, so outcomes are cached in the worker by content hash and meshes on the main thread by body key.

## ADR-17

**Regeneration on every command; refusals guard the target.** Each command regenerates the whole timeline, which is cheap thanks to the caches. A command is refused when its own target fails (a feature that cannot be built, a sketch that conflicts). A parameter change is refused when it breaks anything that worked before. Upstream edits that break a later feature are accepted, and the timeline marks that feature as failed with the reason, as in other parametric CAD tools.

## ADR-18

**Manufacturability analysis in TypeScript, on cached fine meshes.** The Analysis Engine runs in the geometry worker next to the shapes. Exact questions (distances, angles, areas, radii, mass properties, closed solids) go to OCCT. The printability checks work on a fine mesh: overhangs from the triangle normals, wall thickness by casting a ray from every triangle into the material through a bounding volume hierarchy ([[src/core/engines/analysis/ray-caster.ts]]).
*Measured* (Node, a 200 × 200 mm plate with 100 filleted holes, 51,000 triangles): a full print check takes 1.65 s, of which OCCT's meshing is 1.1 s and the TypeScript ray casting 0.18 s. Rust/WASM ([[Architecture/Decisions#ADR-8]]) would speed up the smallest part, so the analysis stays in TypeScript. Meshes are cached by shape key instead, which brings a repeated check down to 0.53 s; unchanged bodies keep their keys, so re-checking after an edit only meshes what changed.
*Trade-off:* the wall check samples one ray per triangle, so a thin spot inside one large flat triangle can be missed. Curved faces are finely meshed, and flat walls have their thickness measured exactly.

## ADR-19

**Material and manufacturing profile belong to the component; kerf is applied on export.** The material (for mass) and the machine profile (printer or laser, for validation) are stored in the component document and changed by commands (`set-material`, `set-process`), so they are saved, undoable and travel with the design. Presets live in [[src/core/contracts/analysis.ts]]. Kerf compensation is not modelled as geometry: the drawing export offsets every profile loop by half the kerf away from the material ([[src/core/utilities/math/offset.ts]]), extending or trimming neighbouring edges so corners stay sharp. Curves that bound no profile, such as engraving lines, are exported unchanged.
*Why:* the design stays at its true size for printing and for other cutters. A laser with a different kerf only needs another export.
*Trade-off:* a machine profile per component rather than per user. Sharing machines between components is left to a later settings store.

## ADR-20

**Kinematics: a spanning tree, plus damped least squares for loops.** The Kinematics Engine ([[src/core/engines/kinematics/index.ts]]) walks the joints breadth first from the grounded instances (and from the first instance of any unconnected group), so most assemblies are placed directly by composing frames: `B = A · frameA · motion(values) · flip · frameB⁻¹`. Joints that close a loop (a four-bar linkage) are kept by adjusting the free values of the tree joints with Levenberg–Marquardt on the loop's constraint errors, while *driven* joints (the one being dragged, the keyed ones of a motion study) keep their values. Limits clamp values. Values are mm and degrees in the document, and solved values are written back, so the document always describes a consistent pose.
*Why:* trees are exact and instant, which covers hinges, sliders and robot-arm chains; loops need iteration only where they exist. The engine is pure TypeScript on the main thread: assemblies of home projects have tens of joints, not thousands.
*Trade-off:* no dynamics (forces, gravity, contact). Motion studies are kinematic: keyframes are interpolated linearly and every frame is solved, starting from the previous one so loops follow the motion.

## ADR-21

**Joint frames come from geometry, with fixed conventions.** A joint attaches to a face or edge of a component ([[src/core/engines/modeling/occt-modeling-engine.ts]] `frameOf`). A flat face gives its centroid and outward normal; a cylinder, cone or circular edge gives its axis (through the point nearest the element's centre); a straight edge gives its middle and direction. Axes without an inside point along their largest positive world axis, so holes in parts lying on XY turn counter-clockwise seen from above. Side A stays and side B moves; two flat faces start turned face to face (`flip`).
*Why:* joint angles and distances mean the same thing in every part, whatever direction OpenCascade happens to store an axis in.
*Trade-off:* the joint origin cannot be offset from the picked geometry yet; use a construction plane in the component when a joint needs to sit elsewhere.

## ADR-22

**Import: own readers, kernel only where solids are needed.** STL (binary and ASCII), OBJ, 3MF (deflated ZIP through the platform's `DecompressionStream`, with units, components and build transforms), DXF and SVG are read in TypeScript ([[src/core/engines/interchange/mesh-readers.ts]], [[src/core/engines/interchange/drawing-readers.ts]]); workers have no `DOMParser`, so a small XML reader serves 3MF and SVG. STEP goes through OCCT. Viewing and mesh-to-mesh conversion never touch the kernel, so meshes of any size open. A mesh becomes a solid (for components, assemblies, STEP) through OCCT's STL reader, merging of coplanar triangles and one sewn shell, oriented by the sign of its volume; this is capped at 100,000 triangles (measured: 0.7 s for 4,000, about 4 s for 20,000 triangles).
Drawings keep lines, circles and arcs exact (DXF bulges become arcs); splines, ellipses and Béziers become lines within 0.05 mm. Curve ends that meet share one sketch point, so imported outlines form profiles. SVG's view box bottom left becomes the origin, with Y up; DXF follows `$INSUNITS`.
Imported solids enter a component through an **Insert body** feature and an assembly as an instance; the Modeling Engine names their faces `f:<feature>:new:<n>` by position, so references on them survive regeneration as long as the file stays the same.
*Also decided:* main-thread code may import the kernel-bound engines and Shape Access only as types. A value import had doubled the start-up bundle (94 kB to 178 kB); the architecture test now refuses it.
*Trade-off:* curves become lines rather than fitted arcs, and a sketch gets one point per line end (no constraints). DXF blocks (INSERT), text and hatches are skipped.
*Later:* text in [[#ADR-26]]; fitted arcs, blocks, hatches, drawings kept as one piece and inferred relations in [[#ADR-27]].

## ADR-23

**Delivery: one CI workflow, GitHub Pages for the web app, Angular's service worker for offline use.** `.github/workflows/ci.yml` checks every push and pull request (`npm run verify`; the Playwright journeys against the dev server and against the Pages build) and, on `master` only and after both passed, publishes the Pages build. The web app is built for its sub-path (`npm run build:pages`, base `/<repository>/`); static hosts answer unknown paths with `404.html`, which is a copy of `index.html`, so deep links open the app. The kernel and solver URLs were already relative to the document and the worker, so nothing else changed.
Offline use comes from `@angular/service-worker` ([[ngsw-config.json]]): the app shell is cached on install, the WebAssembly kernels (OpenCascade 23 MB, planegcs 1 MB) on first use. Once a part has been modelled online, the app works without a network. A new version downloads in the background and a notice offers to reload. The desktop app registers no service worker: it is installed and bundles everything.
*Why:* Pages is free, needs no server, and serves from the repository the code lives in; the Angular service worker is maintained with the framework and versions the cache by content hashes, so an update never mixes old and new files.
*Trade-off:* the kernels are not prefetched, so a browser that never modelled online has no kernel offline; prefetching would cost every first visit 24 MB. CI runs without a GPU, so the journeys there use software WebGL (SwiftShader), never WebGPU.

## ADR-24

**How the model is seen is view state; how bodies look is document state; how the user works is a preference.** Three kinds of state, kept in three places:
- *View state* (camera, projection in effect, section plane) lives in the viewport ([[src/app/viewport/viewport.ts]]) and is never saved with a document: looking at a part must not change it.
- *Appearance* (hidden, colour, opacity of a component's bodies and of assembly instances) is stored in the document (`appearances` by body id; `Instance.appearance`) and changed by undoable commands (`set-appearance`, `set-instance-appearance`). It never changes geometry; an instance's appearance overrides its component's ([[src/app/viewport/looks.ts]]).
- *Preferences* (control scheme, preferred projection) belong to the user, not to a project, and are kept in the browser's or desktop app's local storage ([[src/app/shared/user-settings.ts]]).

Keys go through one keymap ([[src/app/shared/keymap.ts]]): commands with scopes (`sketch`, `modeling`, `document`, `view`, `app`), each scheme's chords, and the mouse buttons. Parts of the editor register handlers for their scope while they are shown ([[src/app/shared/shortcuts.ts]]); a sketch being edited switches modeling shortcuts off, and the most specific scope handles a command. Typing in a field never triggers a shortcut.
*Also decided:* the section view uses the renderer's clipping (three.js `ClippingGroup`), and each body carries its inside faces drawn flat in the section colour: where the cut opens a closed body, those read as its cut surface, without computing the section. Vertices are named by the edges that meet there (`v:<edge names>`, [[src/core/contracts/feature.ts]] `vertexName`); the viewport finds them on screen within 8 px of the cursor and skips those behind a surface, because they are too small to hit with a ray.
*Trade-off:* the cut surface is an effect of drawing, not geometry, so it cannot be measured or exported; an exact section (a boolean with a half space) can follow if needed. The Fusion 360 and Onshape styles follow those programs' best-known defaults, not every binding.

## ADR-25

**Sketcher tools: free-form curves exact end to end, editing as pure functions, relations that keep intent.**
- *Ellipses and splines.* An ellipse is a centre point, a major-axis end point and a minor radius; a spline is its fit points (open or closed), drawn as one cubic Bézier per gap with tangents from neighbour to neighbour ([[src/core/utilities/math/curves.ts]]). The solver moves their points; an ellipse's minor radius is set by a radius dimension after solving. Profiles keep Bézier and ellipse pieces exact (the kernel builds them with `cubicBezierCurveTo` and `ellipseTo`); where another curve crosses them, the crossing is found numerically (bisection, Newton for two free-form curves) and areas are integrated exactly (Gauss–Legendre). SVG writes them exactly; DXF R12 has no splines or ellipses, so they become polylines within 0.005 mm. Extruded and revolved side faces of free-form pieces are named by a point they must pass through.
- *Tangency at a shared point.* A line and an arc (or two arcs) that share an end point are made tangent with planegcs' angle-via-point, as FreeCAD does: the plain tangency plus the shared point counted as redundant.
- *Editing* (trim, extend, split, offset, fillet, chamfer) lives in the Sketch Engine as pure functions that return an edit ([[src/core/engines/sketch/editing.ts]]); the Design Manager applies it as one undoable `edit-sketch` command, with its usual removal of orphaned points and relations. New ends on other curves keep a point-on relation. Offsetting reuses the kerf code (`offsetChain`).
- *Copies keep intent:* a mirror image is held by symmetric relations; pattern copies keep the relations among their curves and are placed by dimensions (linear) or by equal construction spokes at the pattern angle (circular). Pasted geometry keeps its dimensions' expressions.
- *Projected geometry* is a `projection` entity (edges or faces) whose points and curves live in the sketch as `<projection>:<n>` and are refreshed from the bodies on every regeneration ([[src/core/managers/design/regeneration.ts]]); the solver keeps their points fixed. Relations to projected points survive while the projection's shape stays the same.
*Trade-off:* points cannot be put on ellipses or splines, and trim, extend and fillet do not work on them yet. Pattern copies are placed by dimensions rather than by a pattern feature, so changing the spacing means changing each copy's dimensions. A projection whose edge is gone makes the sketch fail until it is deleted.

## ADR-26

**Text is outlines of one bundled open font, computed when a sketch is solved.** A sketch `text` entity is an anchor point, the text, its cap height in mm, a weight (regular or bold) and an angle ([[src/core/contracts/sketch.ts]]). The Sketch Engine lays it out after solving, at the solved anchor, with the bundled **Inter** font (`@fontsource/inter`, SIL Open Font License 1.1) read by **opentype.js** (MIT) ([[src/core/utilities/text/index.ts]]). The outlines are lines and cubic Béziers (quadratic curves raised exactly), so they become profiles, extrude and cut like any curve, and export exactly. Height is the height of capitals, so 10 mm text has 10 mm capitals whatever the font.
Fonts are files served next to the app (`fonts/`, cached by the service worker for offline use) and fetched once per weight in the window and in the geometry worker; Node tests read them from the package. opentype.js is loaded on first use, so it is not in the start-up bundle.
Imported SVG `<text>` and DXF `TEXT`/`MTEXT` become editable sketch texts in this font (SVG `font-size` is the em size, converted to cap height); converting a drawing to another format writes the outlines.
*Why:* outlines keep text a pure function of its few parameters, so it stays editable and needs nothing from the kernel; one open font avoids system-font differences between browsers and the desktop app.
*Trade-off:* one font family. Glyphs are placed one by one with their advances: Inter's kerning sits in a GPOS lookup opentype.js cannot read, and contextual substitutions are not applied. Characters the font lacks show as its empty glyph. Text cannot carry relations other than through its anchor.

## ADR-27

**Imported drawings: exact where possible, fitted arcs elsewhere; one piece by two handles; relations on request.**
- *Curves.* Lines, circles, arcs, full ellipses and SVG cubic Béziers stay exact. Splines, partial ellipses, quadratic and elliptical SVG pieces are sampled and fitted with as few lines and arcs as stay within 0.01 mm of the curve ([[src/core/utilities/math/fit.ts]]): greedy, the longest arc or line from each start, lines preferred where straight.
- *DXF blocks and hatches.* The reader places entities by an affine matrix: `INSERT` with base point, scale, rotation and column/row arrays, nested up to 8 levels; hatch boundaries (polylines with bulges, line, arc, ellipse and spline edges) become curves. Placement keeps curves exact under similarity transforms (mirrors reverse arcs) and samples and fits them under non-uniform scaling ([[src/core/engines/interchange/drawing-readers.ts]]).
- *One piece.* A `drawing` sketch entity names the imported document and two points: `origin` at the bottom left of the drawing's extent and `handle` at its bottom right. On every regeneration the drawing is read (cached per original) and placed by the similarity that maps its bottom edge onto origin → handle, as generated geometry `<drawing>:<n>` whose points the solver keeps fixed, like projections ([[#ADR-25]]). Moving, turning or dimensioning the two handles moves, turns and scales the whole drawing in proportion; when solving moves a handle, the drawing is placed again and solved once more ([[src/core/managers/design/regeneration.ts]]). Moving any piece moves the handles; deleting any piece deletes the drawing.
- *Relations* for drawings inserted as curves ([[src/core/engines/sketch/relations.ts]]): none; *inferred* (lines within 0.06° of horizontal or vertical; lines and arcs that meet at a shared end in the same direction become tangent; shared ends are already one point); or *fixed* (every point). An arc with its centre and both ends fixed is pinned once too often, so the solver leaves one coordinate of one end to the arc.

*Why:* a logo or a part outline usually has to keep its proportions, and two points are the smallest handle a constraint solver can move, turn, scale and dimension. Geometry generated from the original keeps the document small and exact.
*Trade-off:* the drawing scales uniformly (no stretching). While a handle is dragged, the drawing follows on release, not live. Curves of a one-piece drawing cannot be trimmed or edited; insert it as curves for that.

## ADR-28

**Part modeling II: the timeline can roll back; new features come from the kernel's own builders and history; gaps in the kernel build are worked around, not hidden.**
- *Timeline.* `rollbackIndex` counts the rolled-back items at the end, so documents saved before needed no migration (0: none). New items go in at the marker, and the marker stays after them. Reordering is checked against what each item uses (`itemDependencies`), and the command is refused if the moved item then fails.
- *Body operations* are features like any other (combine, split, move/copy, scale): body ids stay stable (a split's back piece and copies are named after the feature), and moved bodies keep their face names.
- *Loft, sweep and draft* are built with OpenCascade's builders directly (`ThruSections`, `MakePipeShell`, `DraftAngle`) rather than replicad's wrappers, so their history names the faces: sides after the profile edge that generated them, drafted faces after themselves ([[src/core/engines/modeling/tools.ts]], [[src/core/engines/modeling/draft-rib.ts]]).
- *Freeform naming (CAD-47).* A freeform face keeps an earlier face's name when probe points of that face's surface lie on its own (untrimmed) surface: holes cut through a loft side keep its name. Planes also match facing the other way.
- *Holes* are revolved half-sections (one profile for simple, counterbored and countersunk holes) or, as teardrops, extruded outlines; *threads* are a marker by default and, when modelled, a 60° groove swept along a helix with a fixed binormal and cut ([[src/core/engines/modeling/holes.ts]]).
- *Kernel build gaps.* `replicad-opencascadejs` binds neither `gp_Cone` nor `gp_Torus`, so cone and torus faces are read as freeform surfaces (revolves recognise them by a point they pass through); it has no `BRepBuilderAPI_GTransform`, so bodies scale only uniformly. No point-in-solid classifier is bound either: threads start at the end of the face nearer the outside of the body's box, with *flip* as the escape.

*Why:* the builders' history is the only exact link between a sketch curve and the face it made once surfaces are freeform; geometric guesses only work for analytic surfaces.
*Trade-off:* a rib goes a set depth rather than up to the next face; holes are flat-bottomed (no drill point); modelled threads are slow to build and can fail on long threads; scaling per axis waits for a kernel build with `GTransform`.

## ADR-29

**Parameters and sheet metal: millimetres stored, units at the edges; parameters from the project and configurations replace expressions before evaluation; sheet metal as features with an analytic flat pattern.**
- *Units.* Geometry and plain numbers stay millimetres. The app formats lengths in the component's unit and writes the unit out when a plain number is typed in another unit (`lengthExpression`), so `set-units` changes nothing stored and no migration or expression rewriting is ever needed.
- *Project parameters* live on the project record. The Project Manager checks them (the Parameter Engine) and publishes `projectParametersChanged`; open design sessions regenerate, and component results carry a stamp that includes them (`resultStamp`), so assemblies see stale results and ask again.
- *Configurations* are rows of expressions by parameter name, applied to the parameter list before evaluation (component and project parameters alike). A configuration change is a parameter change: refused if it would break the model. Results are kept per configuration (`resultKey`, stored under the same key path, so IndexedDB needed no upgrade), and assemblies load each `component@configuration` source separately.
- *Sheet metal.* The base flange is an extrude by the sheet thickness that also holds the rules (one sheet per component). Edge flanges are built from their cross-section (a bend ring around the inside radius, then the flange) extruded along the edge and joined, which keeps the geometry exact and their faces named. The flat pattern is computed from the features, not by unfolding the solid: the base outline with each flange laid flat beyond its edge by the bend allowance θ(r + K·t), and one bend line in the middle of each bend, on its own layer.

*Why:* converting stored numbers on a unit change would rewrite the model's history; keeping one internal unit makes the change a display setting. An analytic flat pattern is exact for the flanges this phase builds and needs no unfolding algorithm in the kernel.
*Trade-off:* only flanges standing on the base flange unfold; no corner relief; one sheet per component. Assemblies show millimetres.
