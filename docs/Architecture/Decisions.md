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
*Later:* text in [[#ADR-26]]; fitted arcs, blocks, hatches, drawings kept as one piece and inferred relations in [[#ADR-27]]; repairs, simplified copies of large meshes and KiCad boards in [[#ADR-59]].

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
*Trade-off:* only flanges standing on the base flange unfold; no corner relief; one sheet per component. Assemblies show millimetres. (Flanges on flanges, corner reliefs, hems and miter flanges came with [[Architecture/Decisions#ADR-57]].)

## ADR-30

**Projects: versions are a git repository per project, written with isomorphic-git through the host's file system; sync is git over HTTP; sign-ins live in memory only.**
- *History.* Version Access keeps a bare repository per project (`projects/<id>/.git`): on the desktop in the project folder, in the browser on an IndexedDB file system (`IndexedDbFileSystem`, one entry per path), in tests in memory. isomorphic-git (pinned, loaded lazily with the global `Buffer` it needs; the `buffer` package arrives as named or as default export depending on the bundle, so both are read) writes blobs, trees and commits directly; there is no working tree. A version is recorded only when the tree changed; names are lightweight tags.
- *Files of a version.* Documents without their project id, imported originals (immutable by asset id, so a recorded one is reused without reading the asset again) and the project's settings. Pictures and component results are caches and stay out.
- *Sync.* `fetch` lists the remote's `main` (empty remotes are fine) and fetches it; the Project Manager then pushes, fast-forwards (`advance` + apply) or merges. The merge is per file against the common version, which for CADence is per document: one side changed → that side; both → a conflict the user resolves (mine or theirs). The merge version has both parents, so histories stay git histories any git tool understands.
- *Remotes and sign-in.* The remote's address and an optional CORS proxy are stored on the project; user name and password or token are passed per sync (`onAuth`) and kept by the client in memory (`RemoteSignIns`) until the app closes. Remote failures become `remote-unreachable`, `remote-unauthorized` or `remote-rejected` results.
- *Pictures.* The viewport renders a snapshot with its own camera from the home direction, without grid or helpers, 1.5 s after content settles; the editor saves it through the Project Manager as an asset.
- *Tests* run against a real git server: the system's `git http-backend` behind a small Node server ([[src/core/access/version/testing/git-http-server.ts]]), in unit tests and in the browser journey across two browser contexts.

*Why:* git is the history format people already have tools, hosts and backups for; isomorphic-git runs the same code in the browser, in the desktop webview and in Node, over the file system abstraction the app already has. Per-document conflicts match how people think about a project and keep the merge exact without knowing every document schema.
*Trade-off:* browsers need a CORS proxy for most git hosts, and a third-party proxy sees the traffic, sign-in included (run your own for private work). Two people changing the same document must pick one side (merged item by item since [[Architecture/Decisions#ADR-61]]). Version names are not synced. Large originals make the browser repository grow, since git keeps every file ever recorded.

## ADR-31

**Automation: one Node client over the managers, used by scripts, the command line and an MCP server; commands are the vocabulary.**
- *A client, not a new layer.* `src/automation` calls the managers like the Angular app does, composed by `createNodeCore` (`src/core/composition/node.ts`): project folders through `NodeFileSystem` (the desktop app's layout, so both see the same projects), exports through `FolderDeliveryAccess`, and the kernel in-process. Node-only adapters live in each component's `node.ts`, a third entry point next to `index.ts` and `testing/`, open only to Node code; the architecture test enforces it.
- *The scripting API* is the Project Manager as it is, plus `ComponentScript` / `AssemblyScript` sessions: `run(...commands)` (throws `CadenceError` at the first refusal), `summary()` as plain JSON, exports that return the written path. Scripts get it as the argument of their default export (`cadence run script.mjs`); Node 24 runs TypeScript scripts as they are.
- *Commands are the vocabulary* for scripts and agents alike: the design and assembly commands the app records ([[Architecture/Decisions#ADR-10]]). Three shorthands (`add-rectangle`, `add-circle`, `add-polygon`) expand into fully constrained sketch geometry; everything else is written as the app writes it.
- *MCP* is served over stdio with newline-delimited JSON-RPC, written by hand (initialize, ping, tools/list, tools/call): fourteen tools over the API, instructions with a worked example on connect, and `command_reference`, which returns the TypeScript source of the commands, features and sketch types embedded at build time, so the reference never drifts from the code. Everything except messages goes to stderr.
- *Build.* esbuild bundles `src/automation/main.ts` into one module with packages external (`npm run build:automation`), so the kernel and solver load their WebAssembly from `node_modules` as in the tests.
- *Tests:* the MCP server and the command line run in unit tests on real folders with the kernel, the built bundle is driven over stdio, and a browser journey opens a part a script made, through git (evidence 61).

*Why:* the managers already are the application's API and the commands its language, so automation needs adapters, not a second model; the same types serve as the documentation for people and agents. A hand-written MCP transport is small, has no dependencies and is tested end to end.
*Trade-off:* the command line runs from a copy of the repository (not published as a package); the MCP server has no rendering, so agents read geometry as data (faces, edges, profiles, mass properties) rather than pictures; browser projects reach Node only through git.

## ADR-32

**Releases: one version everywhere, installers and signed updates from GitHub releases, credits generated from the dependencies, and the desktop app tested as built.**
- *Version.* `0.<phase>.<fix>`, written in package.json, package-lock.json, tauri.conf.json, Cargo.toml and Cargo.lock; [[tools/release/version.mjs]] sets all of them and a test checks they agree. A tag `v<version>` starts the release workflow, which refuses tags that do not match.
- *Installers.* Tauri's NSIS installer (per user, no administrator rights) and MSI, built on a Windows runner. Code signing waits for a certificate; the configuration has the place for it.
- *Updates.* `tauri-plugin-updater` reads `latest.json` of the latest GitHub release and accepts only files signed with the key whose public half is in tauri.conf.json (minisign; the private key is a repository secret). The update files are made only by the release configuration (`tauri.release.conf.json`), so local builds need no key. In the app, `AppUpdates` hides the difference: the service worker's ready version on the web, the updater's release on the desktop, both behind the same notice.
- *Links on the desktop* (`target="_blank"`) open in the user's browser through `tauri-plugin-opener`; the webview would otherwise ignore them.
- *Credits.* The About dialog lists every production package (and the font) with its licence, generated by [[tools/licences/licences.mjs]] from package.json and node_modules, and the full texts come with the app (`third-party-licences.txt`). OpenCascade and planegcs are LGPL: they stay separate, replaceable WebAssembly files, and their sources are linked.
- *Desktop smoke test.* The built app runs with WebView2's remote debugging, Playwright attaches over CDP, and a PowerShell script answers the native save dialog with Win32 messages (UI Automation finds the dialog's controls but cannot operate them). It runs in CI on Windows.
- *Tauri plugin versions.* The npm package and the Rust crate of a plugin must share major and minor version; the crates are pinned with `~major.minor` to the npm versions.

*Why:* releases must not depend on remembering five files or a list of licences; signed updates are what makes a desktop app safe to keep current; testing the real executable catches what the browser journeys cannot (IPC permissions, native dialogs, the app data folder).
*Trade-off:* unsigned installers trigger SmartScreen until a certificate is bought; the desktop smoke test touches the real app data folder (it removes its own project, also when it fails); only Windows is built.

## ADR-33

**Projects II: one bundle for copies, archives and templates; the shared viewer is a serialized function; files opened with the desktop app go through two Rust commands.**
- *Bundles.* A project's content (settings, documents, originals) is the unit duplicates, archives and templates are made of. New ids are given by rewriting whole JSON string values that are document or asset ids, so every reference (assembly instances, inserted files and drawings, originals) follows without knowing the document schemas.
- *Archives* are zips (the stored-entry writer and the reader of 3MF, now [[src/core/utilities/archive/index.ts]]). Opening keeps ids and history unless the device has the documents, which keeps one project's history meaningful when it moves between devices, and never lets two projects share a document id.
- *Templates* are generated by scripts on the scripting API ([[src/automation/templates.ts]]) and checked by a test (regeneration without errors, hand-computed volumes), so they stay valid as features evolve. The app only reads JSON.
- *The shared viewer* is a function in [[src/core/utilities/viewer/index.ts]] written into the HTML with `String(runViewer)`: type-checked with the rest of the code, but self-contained (a test compiles it alone). WebGL without libraries: meshes, edges, turn/pan/zoom, ray-cast measuring, hiding and exploding parts.
- *Open with CADence.* The installer associates `.cadence` files only (other formats belong to slicers and CAD programs, and stay available through Open with). The Rust shell lists the files it was started with and reads only those (`opened_files`, `read_opened_file`), so the web client gains no general file access.
- *Version names* travel with sync: names only the remote has are taken (if the version is known), names only we have are sent; a name on different versions is reported, never moved. Versions say whether the remote has them, from the last fetched `origin/main`.

*Why:* one way to copy a project means one place for id handling; generated templates cannot drift from what the app can build; a viewer without dependencies keeps shared files small and working forever.
*Trade-off:* a second app instance opens for each file opened with CADence (no single-instance hand-over yet); removing a name does not remove it from the remote; the viewer measures point to point only.

## ADR-34

**Sketcher III: the solver answers what is free by being pulled; pictures and fonts are imported documents; equation curves, traced pictures and texts along curves are generated geometry.**
- *Freedom.* planegcs reports degrees of freedom but not which parameters carry them, so the Sketch Engine pulls each point a little along x and along y (a drag solve) and sees whether and where it moves: no move, one direction (it slides along something), or two. Two solves a point keep it fast for sketches of up to a few hundred points; the editor asks only while a sketch is under-constrained.
- *Suggestions* come from the sketch as drawn (near-horizontal and near-vertical lines, lengths, sizes, positions from the origin) and are kept one by one only when the solver confirms each takes freedom away without a conflict.
- *Conflicts.* The solver may name only the new constraint among those that conflict, so the regeneration tries removing each one involved (on the same points and curves) and offers those whose removal lets the sketch solve; `DomainError.related` carries their ids to the client.
- *Equation curves* are evaluated by the Parameter Engine with `t` in scope and become a spline through fixed points, regenerated like drawings, so they follow parameters and form profiles.
- *Pictures* (PNG, JPEG) are imported documents: shown behind sketches from their bytes (an object URL), or traced in the Interchange Engine (decoded by the platform, or by a small PNG decoder in Node; pixel-edge contours, Douglas–Peucker, optional Catmull–Rom smoothing) into the same sketch entities drawings make, so tracing reuses one-piece drawings and inferred relations.
- *Fonts* (TTF, OTF, WOFF) are imported documents too, so they travel with archives and sync. The Sketch Engine receives the project's font files through a resolver (keyed by original, parsed once). Google Fonts come from Fontsource's copies on jsDelivr; installed fonts on the desktop through two Rust commands. Text along a curve places each letter at the point and direction of its middle along the curve.
- *Desktop connections.* The desktop app's content security policy now allows `https:` connections: git remotes (ADR-30) and font downloads need them.

*Why:* the user asked for what CAD users expect (Fusion's blue/black and its conflict hints, tracing, fonts); reusing the drawing and import paths keeps each new kind of input small.
*Trade-off:* freedom directions are sampled, not derived (a point on a curve shows the direction where it is now); suggested dimensions are plain values, not design intent; traced outlines are polygonal before smoothing; only 8-bit PNGs are read outside the app; text along a curve does not stretch letters to the curvature.

## ADR-35

**Part modeling III: parts are one feature, `part`, placed at sketch points like holes; the catalogue lives in the contracts and fits are resolved by the Design Manager.**
- *One feature.* Screws, nuts, washers, inserts, magnets, bearings, gears, racks and the printing parts share placement (sketch points, a turn, a flip) and operations, so they are one `part` feature with a `PartSpec` union instead of a dozen feature types. A cut part is the pocket for it.
- *Catalogue in the contracts* ([[src/core/contracts/parts.ts]]): ISO 4762/4032/7089 sizes, ISO 273 clearance and tapping drills, typical heat-set inserts and bearings, as plain data the client (hole presets, size lists) and the Design Manager share.
- *Sizes resolved before the engine.* The Design Manager evaluates the spec's expressions and the catalogue into a `PartSolid` in millimetres and applies fits: holes and dovetail slots get wider, pegs narrower, by `fitAllowance` plus the print profile's `holeCompensation`. The Modeling Engine only builds shapes ([[src/core/engines/modeling/parts.ts]]).
- *Gears* are involute outlines (polylines, 8 steps a flank) extruded, with a twist for helical gears. A matching gear is not generated: the dialog shows the centre distance and the half-tooth turn for the second gear's point, so both stay ordinary, editable parts.

*Why:* the user asked for parts for printed mechanisms; one feature keeps the timeline, dialog, patterns and scripting simple, and placing at sketch points reuses what holes already do.
*Trade-off:* standard parts go into components as bodies, not into assemblies as library instances (a component holding the part does that); screws have no modelled thread; gear teeth are polygonal, and meshing gears have no backlash beyond the printer's.

## ADR-36

**Workflow: folders are ranges of the timeline, repairs work against the bodies just before the feature, and the command palette lists what the shortcut system can run.**
- *Folders* store their first and last item, not a list: a folder is always a consecutive run of items, so the timeline stays one ordered list (regeneration, rollback and dependencies are untouched). Reorders and deletes recompute the ends from the items the folder had. Whether a folder is open is how the timeline is looked at, so it is not stored.
- *Repair* regenerates the component up to the broken item and compares the persistent names it refers to with the faces and edges of those bodies (a vertex lives while its edges do). Candidates are ranked by distance from where the lost one was picked (the reference's hint) to the meshes' triangles and edge segments, so no geometry kernel call is needed. `replace-reference` rewrites every use of the name in the item and is accepted while the item still fails, so references can be repaired one by one. The editor rolls the model back to the item while repairing, so the view shows (and picks from) exactly those bodies.
- *Configurations as CSV* go through the Design Manager: it knows the parameters in effect (the project's and the component's) and evaluates every row with the Parameter Engine before anything is applied. Reading accepts commas and semicolons (spreadsheets in many languages write semicolons); configurations keep their ids by name, so assembly instances keep theirs.
- *The command palette* asks the shortcut service for the commands handled in the scopes in effect, plus actions that parts of the editor register while they are shown (features, documents, exports, settings). Nothing is listed that cannot run where the user is.

*Why:* the user asked for structure and repair tools of a mature CAD timeline, spreadsheet editing of variants and a Ctrl+K palette; each reuses an existing mechanism (rollback, regeneration, commands, shortcut scopes).
*Trade-off:* folders do not nest; a moved first or last item can shrink a folder; candidates are by distance only (not by shape or size); the palette searches names, not descriptions.

## ADR-37

**Assemblies II: patterns are copies after the kinematic solution, the move handle edits the document's own values, and tabs share events over a BroadcastChannel.**
- *Patterns* are expanded after the joints are solved: each copy is its original's pose times the pattern's transform (a translation, a turn about an axis, or a reflection). So copies follow everything that moves their originals, and the kinematic model stays as small as the user built it. Copies have ids of their own (`<pattern>/<instance>/<k>`) for display, picking, measuring, mass, interference and export, but joints may not use them. Mirrored copies are reflections (determinant −1); OCCT and three.js handle them.
- *Joint offsets* are part of the joint origin and applied to the picked frame (along its axes, then a turn about its normal), so they move with the geometry they were picked on.
- *The move handle* (three.js `TransformControls`) never moves anything itself: a free instance's drag becomes `move-instance`, a jointed one's becomes the joint's values (the handle sits on the joint frame on A and shows only its free axes; the drag is read in that frame), previewed like a slider and saved once on release.
- *Mass* comes from the Analysis Engine per component body (`properties` with the component's material density), with centres moved to where the instances are.
- *Live updates:* the composition root relays domain events between tabs and windows over a `BroadcastChannel` (`cadence-events`). A saved document arrives as `documentChanged`, not `documentSaved`, so only the tab that saved it records a version; results are read from the shared storage, and a stale one is regenerated where it is needed.

*Why:* the user asked for direct manipulation, offsets, measuring and patterns as in other CAD assemblies, and for assemblies that follow edits made elsewhere.
*Trade-off:* the handle moves a jointed part only along the free directions of the joint that places it as the moving side, one kind of freedom at a time (slides before turns); copies cannot carry joints; another tab's edit shows once its result is published or regenerated (a second or two).

## ADR-38

**Motion and assembly documents: links set driven joints before each solve; collisions are interference checks of sampled frames; instructions are a PDF the Assembly Manager writes from pictures the client takes.**
- *Links* are linear couplings of joint freedoms (`driven = offset + ratio × driver`). The Kinematics Engine applies them before solving (chains in order) and holds the driven joints like keyed ones, so loops close around them. The offset is set when a link is made or changed, so nothing jumps. Chains may not close into a circle, and a joint follows one link, which keeps the order well defined.
- *Easing* is smoothstep on the segment into a key; *speeds* are constant rates from the value at the start, and win over keys.
- *Collisions* reuse the Analysis Engine's interference check (OCCT common, bounding boxes first) on frames sampled 10 times a second, and report the first frame each pair overlaps; touching does not count. Between samples a fast part can pass through a thin one.
- *Exploded views* are steps that add up; poses come from the session (`explode`), so the client only shows them and draws trails.
- *Instructions* need pictures, which only the client's view can take: it shows each state, takes a JPEG framed on the fully exploded box, and hands them to the Assembly Manager, which lays out the pages with a small PDF writer of its own ([[src/core/utilities/pdf/index.ts]]: Helvetica text, lines, JPEG pictures). Technical drawings (Phase 22) use the same writer.

*Why:* the user asked for linked mechanisms, believable motion with collision checks, exploded build instructions and a parts list; each builds on the kinematic model, the interference check and the result data already there.
*Trade-off:* links are linear (no cams); collision checks are sampled; instruction pages use Helvetica (Latin-1 text) and pictures from one direction.

## ADR-39

**Technical drawings are their own document kind and manager; views come from published results through OCCT hidden-line removal, and one sheet layout serves the editor, PDF and DXF.**
- *A document kind.* A drawing references components and assemblies by id, like an assembly, so it travels with archives, copies (ids rewritten), versions and sync. A new Drawing Manager owns it; it is loaded lazily, so start-up stays as small as before.
- *Views from results.* Drawings read the same published results as assemblies (ADR-11): components are asked to regenerate when stale, and assembly editors now publish their placed parts too. So a drawing never runs a timeline or a kinematic solve.
- *Projection* uses OCCT's HLR (through replicad's `makeProjectedEdges`) in the geometry worker; hidden edges right under visible ones are dropped. Sections cut the bodies with a large box before projecting and report the faces on the cut plane as segments, hatched by even-odd crossings. Details clip their parent's projection to a circle, without projecting again.
- *Attachments by name.* The view also returns the model's named vertices, circular and straight edges projected the same way; annotations store those persistent names, so dimensions follow model changes and report when their geometry is gone.
- *One layout.* A pure function turns the document, the view geometry, callout texts and parts lists into sheet primitives (paths with an ISO line style, texts, arrowheads); the editor draws them as SVG, the PDF writer and a small DXF writer export them.

*Why:* the user asked for drawings with views, sections, details, dimensions, callouts and parts lists, exported as PDF and DXF; results and persistent names already existed to build on.
*Trade-off:* sections are full sections across the view (no offset or half sections); dimensions on isometric views are not true lengths (both lifted by [[Architecture/Decisions#ADR-58]]); text is Helvetica (Latin-1 in the PDF); assemblies must have been opened once to be drawn.

## ADR-40

**Visuals: finishes are part of the appearance, the realistic look is a viewer setting, surface analysis colours vertices, and scripts render pictures in software.**
- *Finishes* (matte, plastic, metal, glass, wood) are stored with a body's or an instance's appearance, like its colour, as roughness and metalness for three.js's standard material. *Realistic lighting* is how one person looks at models, so it is a user setting (like the projection): a room environment (`RoomEnvironment` through the WebGPU renderer's `PMREMGenerator`) for reflections, and a shadow-catching ground under the model.
- *Pictures and turntables* are taken by the viewport from what it shows: the renderer resized for a moment to the picture's size (helpers hidden), or the camera turned once about the vertical axis while the canvas stream is recorded. Files reach the user through the Project Manager (`deliverFile`), like every export.
- *Surface analysis* colours each vertex (zebra by the normal's angle to a fixed axis, curvature by how fast normals turn between neighbouring vertices, draft by the normal against the pull direction) and draws the faces unlit. No shader code: it works the same on WebGPU and WebGL.
- *Pictures for agents* need no GPU: a small software renderer in the core utilities (depth buffer, two-sided soft shading, edges) draws the tessellated bodies orthographically, and a PNG encoder (deflate by the platform's `CompressionStream`) writes them. The API (`picture()`), the command line and the MCP tool `render_picture` (an image result) all use it.

*Why:* the user asked for nicer pictures to share, for surface checks known from other CAD programs, and for agents that can look at what they made.
*Trade-off:* zebra stripes are fixed to the model, not the camera; curvature is a mesh estimate; software pictures have no reflections or shadows; turntables are recorded in real time.

## ADR-41

**Simulation: a small linear static finite element solver in TypeScript, on a grid mesh moved onto the surface.**
- *Mesh:* the body is filled with a grid of cubes (kept where their middle is inside, tested by ray parity on the display mesh), each split into the same six tetrahedra so neighbours fit. Corner nodes on the boundary move onto the nearest point of the surface; a move that would turn a tetrahedron inside out is taken back. No Delaunay mesher is needed, and the mesh never fails on odd geometry.
- *Elements:* 10-node quadratic tetrahedra with a four-point Gauss rule. Linear tetrahedra are far too stiff in bending; quadratic ones match beam theory within a few percent with two elements across.
- *Solver:* the stiffness matrix in 3 × 3 block CSR, solved by conjugate gradients preconditioned by symmetric Gauss-Seidel sweeps (about three times fewer steps than the diagonal alone). Loads are consistent for 6-node triangles (all of a uniform load on the mid-edge nodes).
- *Results:* von Mises stress at the corners of each element, averaged at nodes. The viewport draws the solution's own surface (each quadratic face as four triangles) coloured and bent; the display mesh stays underneath, hidden, for picking.
- *Where:* in the Analysis engine (geometry worker), from the display meshes the session already has, so OCCT is not needed. The setup (fixed faces, loads, element size) is part of the component document; the result is not stored.

*Why:* the user asked for a simple strength check; a hobby part needs a credible number and picture, not a professional solver. Pure TypeScript keeps it in the existing worker with no new build steps.
*Trade-off:* the grid makes sharp edges slightly round and cannot follow features smaller than an element; no contact between bodies, no plasticity, no anisotropy of printed parts. (The solver's slowness on slender parts is fixed by ADR-42.)

## ADR-42

**Performance: measure with benchmarks, fix the algorithms, and keep TypeScript (no Rust/WebAssembly port).**
- *Benchmarks* (`npm run bench`) build large models through the scripting API and time each step; `e2e/performance.spec.ts` counts the geometries the browser holds. Numbers and history: [[Architecture/Performance]].
- *Sketches* are solved in independent parts (joined by constraints, shared points and generators; the fixed origin joins nothing), and region finding skips pairs whose boxes do not meet.
- *Profiles with holes* become one replicad compound blueprint (outline and holes) instead of a boolean cut per hole: the sketch engine already proved the holes lie inside and apart.
- *Faces and edges* are listed with `facesOf` / `edgesOf` (Shape Access), which deduplicate by OCCT hash code; replicad's getters compare every pair. The order is the same, so names do not change. (Patching replicad itself would be the better fix; it belongs upstream.)
- *The strength check* uses a two-level preconditioner: Gauss-Seidel sweeps and a coarse correction where regions of the part move as rigid bodies (about 120 regions, 6 motions each, solved by dense Cholesky).
- *The printability check* meshes at the view's tolerance; *the viewport* shares one GPU geometry among drawings of the same body mesh, counted and freed with the last.
- *Rust/WebAssembly* was measured on the solver: 1.2× faster than TypeScript, against 5× from the better algorithm. Not ported.

*Why:* the user asked for large models and assemblies to stay usable, and for Rust only where profiling shows a need. Profiling showed quadratic and cubic algorithms, not a slow language.
*Trade-off:* the benchmarks run in Node, not in the browser's worker (same kernels, no transfer costs). Meshing remains the kernel's native time, and instances are still drawn one by one.

## ADR-43

**Booleans, threads and lofts: our own calls into the kernel where replicad's defaults fail (CAD-103, CAD-105, CAD-106).**
- *Booleans* ([[src/core/engines/modeling/booleans.ts]]) build the fuse, cut or common themselves and keep the simplified result (faces and edges on one surface merged) only when it is a valid solid with a plausible volume (a fuse is no smaller than its larger input, a cut no larger than its body). Otherwise they take the unsimplified result, then try again with a fuzzy tolerance of 1e-5 and 1e-4 mm, then tool by tool. replicad simplifies every result, and that broke pads whose end touches a revolved drum for some diameters. Pattern copies are joined or cut in one boolean, since copy after copy each split the faces the next one met.
- *Modelled threads* stop half a groove short of the face's far end: a groove that reached into a shoulder, or out of the far end, cut nothing, without an error. A thread whose cut removes nothing is refused.
- *Lofts* line their sections up before lofting ([[src/core/engines/modeling/sections.ts]]): each section runs the same way round as the one before it, starts where it fits that one best (centre and size taken out), and all sections get the same number of edges, split at matching places along them. The kernel's own matching (`CheckCompatibility`) is off: it picked the nearest vertex and twisted a loft from a circle into airfoils half a turn.

*Why:* the stress test ([[CAD-96]]) hit each of these as an error with no way round it, or as wrong geometry reported as a success.
*Trade-off:* a refused simplification leaves more faces (a split cylinder stays split); the plausibility check measures volumes on every boolean, and the fallbacks cost time only when the first try fails. A thread ending at an open far end is half a groove short. A user cannot yet choose a loft section's start point.

## ADR-44

**Names that hold: faces and edges a feature leaves alone keep their names, `~n` included (CAD-101, CAD-104).**
- [[src/core/engines/modeling/naming.ts]] looks up every face and edge of a result in the shapes of the bodies it came from. One that is still the same element of the kernel (equal hash, `IsSame`) keeps its full name; the others are numbered `~1`, `~2` … by position, skipping the numbers kept names hold. Tools' names are only stems and are never kept.
- Of several earlier faces on one surface, a new face takes the name of the one it is a piece of (a point inside it lies on that face). In a tool, the sweep of each sketch curve is recognised by the point its middle passes through, so curves of two outlines on one cylinder are told apart.
- Round and bevel faces are named after the picked edge nearest them, by geometry; hints are no longer needed.
- The base name of pieces that lie apart is refused without a hint ([[Architecture/Document-model#Persistent references]]).

*Why:* numbers given by position renumbered faces a feature never touched, so references silently pointed at other faces (a chamfer on the ring above a hex moved to a thread crest).
*Trade-off:* names now depend on the history of the feature that made them, not only on the final shape; that history is the timeline, which regeneration replays in the same order. Patterned bodies are numbered without gaps, which renames bodies of documents made before (`kpat:3` becomes `kpat:2`).

## ADR-45

**Agents get changes, filters, assemblies and pictures of motion (CAD-97, CAD-100, CAD-102, CAD-108).**
- *Answers:* `edit_component` and `undo_component` answer with what changed (timeline items, sketches and their profiles, face counts and new face names), not the whole component; `get_component` takes filters (parts, one sketch or body, a name pattern, near a point) and lists face centres and edge middles to pass as hints. A gear's answer went from 165,000 characters to a few hundred.
- *Assemblies:* the same pattern for assemblies (`get_assembly`, `edit_assembly`, `undo_assembly`), plus checks, mass with the bill of materials, and export. The command reference embeds the assembly commands and contracts. Assembly sessions stay open like components.
- *Pictures:* the software renderer frames chosen meshes and draws see-through ones over the others; pictures show exploded views and moments of studies. `animate_study` writes a GIF ([[src/core/utilities/picture/gif.ts]], a fixed 252-colour palette and LZW, no dependency) and returns a sheet of moments as one PNG, since agents look at still pictures.
- *Papercuts:* documents can be renamed and deleted; parts and holes may sit at the sketch origin; a refused sketch says which constraints take part and whether they are redundant or contradictory; shorthand positions take expressions, dimensioned from the origin.

*Why:* the stress test ran out of context on large answers and could neither build nor look at the assembly.
*Trade-off:* an edit's answer leaves out unchanged things, so an agent asks again with a filter when it needs them; the GIF's colours are coarse.


## ADR-46

**Large assemblies in motion: copies move, pairs are screened by their meshes, frames of copies follow their originals (CAD-109 to CAD-115).**
- *Pattern copies* get their poses in every motion frame, the pattern's transform after their original's pose in that frame, and take part in collision checks; exploded view steps may name them, and a *radial* step moves each part away from an axis, so a circular pattern comes apart in one step.
- *Collision checks of a study* test a pair again only when it moved against itself since it was last tested, so parts that stay put against each other (a case and its covers, a hub and its blades) are tested once. Each pair is screened before the kernel's boolean: boxes from boxes measured once per body, then the meshes (a bounding volume hierarchy with separating axes). Surfaces within the meshes' tolerance of each other are measured by rays through the overlap of their boxes along each axis (each ray's overlap less the tolerance, the least of the three axes): surfaces that only touch, such as a piston in its bore, give nothing and never reach the kernel. Far apart, a pair overlaps only if one lies inside the other (ray parity). The kernel's boolean grows its WebAssembly memory by about 180 KB on every call, freed or not, which is why touching pairs must stay out of it: the radial engine's study ran out of memory after twenty moments. replicad's `cast` and `Transformation` also left handles and builders behind; Shape Access's `adopt` and `place` free them. Progress goes to MCP clients as notifications, and a time limit stops long checks.
- *Interference* counts an overlap only above a ten-thousandth of the smaller part's volume: a pin in a hole of its size leaves slivers of rounding.
- *Joint frames on round faces of pattern copies* (names ending in `@<pattern>.<n>`) point the same way round as the original's, turned with the pattern, instead of along their own largest positive world axis. Offsets can *tilt* a frame about its x axis.
- *Cam profiles* are monotone cubics: they keep the shape of their points and never dip below a flat base circle.
- *Agents* get brief assembly answers (what was created in full, joint values, moved origins), the command reference by topic with the parts contract, and `near` measured to the faces and edges themselves.
- *Pictures* bound millions of vertices in loops, never by spreading arrays into `Math.min`.

*Why:* the radial engine ([[CAD-96]]): 121 parts in motion could not be pictured, animated, taken apart or checked within the client's half-hour timeout.
*Trade-off:* the mesh screening meshes each body once at the printability tolerance (memory for large models); an overlap shallower than the meshes' tolerance counts as touching, and the study's collision volumes come from the kernel only for pairs the rays found. The radial engine's study (65 moments, 121 parts) takes 7 minutes; most of it is the screening in TypeScript. Copies' frames depend on their names, so a copy renamed by later features falls back to the world-axis rule.

## ADR-47

**Open documents stay current; writes are whole or not at all; frames come from exact geometry (CAD-116 to CAD-119).**
- *An open assembly follows its components in its own process too:* it reads a component again on `resultPublished` (the design editor, `edit_component` and `undo_component` publish one after every change), not only on `documentChanged` from other tabs. Changes from *other processes* (the app while the MCP server runs, a `cadence run` script) send no event: before an answer, a script's assembly waits for this process's events (`Core.settled()`), then catches up (`AssemblySession.catchUp()`: components whose document's stamp differs from the loaded result's are read again). A component or assembly a script has open is opened again when its document changed on disk, so an agent's edit never overwrites the app's.
- *Answers never come from old shapes without saying so:* checks, pictures, animations, properties and exports refuse with `not-ready`, naming the components, when they are still being rebuilt after two minutes; `edit_assembly` answers list them under `notReady`.
- *Files are written whole:* the Node and Tauri file systems write to a temporary name next to the file and rename it into place (Tauri's `fs:allow-rename`), so a process that ends meanwhile leaves the old file or the new one. A result whose metadata cannot be read counts as missing and is built again; `cadence run` waits for `settled()` before its process ends.
- *Joint frames on round faces* sit at the middle of the face's parameter range along its axis (`UVBounds`), not at the point of the axis nearest the face's bounding-box centre: that box turns with the face and depends on whether the face was meshed, so pattern copies and sessions disagreed by up to 0.8 mm.
- *Joint offsets lean* (turn about the normal) before they tilt, so a joint can point any way from any frame.
- *Refusals say why:* `move-point` on a fixed point names the fix (and offers to remove it, like a conflict); `edit-feature` may change a feature's kind, keeping its id; a revolve whose outline crosses its axis says by how much; other kernel exceptions are decoded (`getExceptionMessage`) instead of "[object WebAssembly.Exception]".

*Why:* the radial engine's third round ([[CAD-96]]): eight parts changed through the MCP server, and its open assembly went on checking, picturing and placing the old ones; a backup opened in a script stopped at an empty result file.
*Trade-off:* every script answer about an assembly first reads each of its components' documents (a file each) to catch up with other processes. Frames on round faces moved for faces whose box centre was off the middle (faces ending on curved surfaces): joints on such faces may sit up to a millimetre differently than before. Pattern copies' frames still differ by about 0.0001 mm, since the kernel approximates each copy's intersection curves anew.

## ADR-48

**Agents reach every manager operation; loops keep their branch; open documents hold their shapes (CAD-120 to CAD-124).**
- *Parity with people:* every operation of the Project, Design, Assembly and Drawing Managers is reachable through the MCP server and the scripting API. Drawings get `cadence.drawing(id)` and five tools: the summary lists each view's anchors (points, circles, lines by persistent name, where they lie on the sheet), which annotations attach to. Operations the app runs through dialogs rather than design commands (inserting a drawing into a sketch, the configuration table, suggested relations) are *session commands* of `edit_component`. Only what serves the app's own screen stays out (thumbnails, drag previews, screen recordings, analysis colours). The MCP tools live in groups below `src/automation/tools/`.
- *Pictures without a GPU* cover what the app shows: a sheet is drawn by a small 2D renderer (strokes, filled glyphs from the bundled font, twice the size then averaged); a section plane clips the 3D renderer per pixel; an animation keeps one camera, framed to the parts over all its frames, and its sheet shows moments of different poses.
- *Build instructions from scripts:* the PDF writer also embeds deflated RGB pixels (FlateDecode), so scripts need no JPEG encoder; the app keeps its viewport's JPEGs.
- *Closed loops keep their branch:* a joint value set from far away is reached in steps of at most 5° or 2 mm, each from the one before, as a motion study does. One jump from bottom dead centre put a slider-crank's piston through the crankcase (the mirror solution, nearest the old values) and saved it.
- *Open documents hold their shapes:* the shape store never evicts what an open assembly or drawing holds (counted holds), and an assembly's result is a snapshot of placed copies that are never stored, so publishing cannot evict its own parts; a body that is gone fails by name instead of dropping out.

*Why:* finishing the radial engine ([[CAD-96]]): the agent could not make drawings, one crank jump flipped the engine, long scripts lost parts from the shape store, and animations jumped.
*Trade-off:* a jump of 180° solves 36 times (a second for the engine); held shapes are not counted against the store's capacity, so memory grows with the open documents. Sheet pictures use Inter, the PDF Helvetica: texts differ slightly in width.

## ADR-49

**Drawing views within a time limit, kept with the drawing; views of configurations; anchors for outlines, centres and extremes; short answers for agents (CAD-125 to CAD-128).**
- *Why one view took eight minutes:* the kernel's exact hidden-line removal spends 460 s on a modelled M10 thread seen along its axis (`HLRBRep_InternalAlgo::Hide`); the same view tilted by 0.02 rad, or seen from the side, takes seconds. It depends on the direction, not on any state: the spark plug's other views had drawn quickly.
- *A time limit:* views are drawn exactly in a worker of their own (the *views worker*, `stoppable` in Messaging; a Node worker for scripts and the MCP server), which is stopped after 20 s, since WebAssembly cannot be interrupted otherwise. Such a view is drawn from the triangles instead (`method: 'mesh'`: a depth picture decides, along each edge and outline, what is seen) and says so in a note. The sheet is laid out first with *Drawing…* in its place.
- *Kept with the drawing:* drawn views are stored as the drawing's result (by source result and view), so a new process opens a drawing at once instead of drawing it again.
- *Configurations:* a view names a configuration of its component, as an instance does, and shows that configuration's result; its callouts use the configuration's values.
- *More to dimension:* the outlines of cylinders seen from the side are lines (`s:<face>:1`, `:2`) with points at their ends; lengths go to circle centres; a diameter goes between two outlines; radius and diameter leaders take an angle, or the first of four that keeps the text on the sheet; every view offers its outermost points seen (also assembly views, whose placed parts carry no names). Anchors say whether the view shows them, and those it does not are not offered unless it draws hidden lines. A section marks its cutting plane on a view that sees the plane edge on. The title block shows the drawn component's material unless it names its own.
- *Seen means a stretch of it:* a line or circle counts as seen where two neighbouring samples along it lie on what the view draws (48 a turn on circles), so one that only touches a drawn edge, at a single point, is hidden ([[CAD-129]]).
- *Few paths from triangles:* runs of samples seen alike become lines between their corners (Douglas–Peucker at half a pixel), outlines from the triangles are chained along shared corners, and the sheet joins lines that go on where the one before ends into one path ([[CAD-130]]).
- *Short answers:* `get_drawing` lists anchors only when asked for (by view, kind, place, diameter, extremes), once per place, each with a short `ref` (the kind and a hash of its name) that annotations accept instead of the name, and its point in the model. Annotations answer with refs; `names` gives the names.

*Why:* drawing the radial engine ([[CAD-96]]): one view blocked every new process for minutes, the crankcase's rear half could not be drawn, shafts and centre distances could not be dimensioned, and reading anchors cost most of the agent's tokens.
*Trade-off:* the views worker is a second kernel (its own memory), and the bytes of a source are copied to it for each view not yet drawn. A view drawn from the triangles is approximate (outlines of free-form faces are polygons) until it is drawn exactly in the background ([[Architecture/Decisions#ADR-58]]).
 Refs change when a name changes, as names do.

## ADR-50

**The command line and MCP server as one self-contained executable (CAD-131).**
- *A Node single executable application:* `npm run build:binary` bundles `src/automation/main.ts` with every package into one CommonJS script (the main script of a single executable can load only Node's own modules), and injects it with `postject` into a copy of the Node that builds it, as `dist/binary/cadence-cli(.exe)`.
- *Files inside:* the geometry kernel's and the constraint solver's WebAssembly, the two fonts and the script itself are assets of the executable. On first start they are unpacked into `cadence-<hash>` in the temporary directory (the hash of the script, so builds never mix; written whole, then renamed), and `NodeResources` passes their paths to the kernels, the fonts and the views worker, which runs the unpacked script.
- *Fonts by package, not by folder:* Node reads the bundled fonts from wherever the font package is installed (`createRequire`), not below the working folder.

*Why:* agents of other projects use CADence's MCP server; the built module needed this repository's `node_modules`, and found the fonts only when started in its folder.
*Trade-off:* the executable is about 120 MB, built per platform, and its copied signature no longer fits; Bun or Deno would compile smaller binaries but run another JavaScript engine than the tests do.

## ADR-51

**Releases for Windows, macOS and Linux, each installer with the command line for agents (CAD-132).**
- *Two executables in one installer:* the desktop app is a Rust program around a web view, the command line a Node single executable ([[Architecture/Decisions#ADR-50]]); one executable for both would mean putting Node into the Rust program. So the command line is a Tauri sidecar (`bundle.externalBin`, as `cadence-cli`) that every installer puts next to the app, and the About dialog asks the Rust shell where it is (`agent_cli`) and shows the `claude mcp add` command for it. Each release also has the command line on its own per platform.
- *Built where it runs:* a matrix of runners (Windows x64, macOS on Apple silicon, Linux x64) builds the command line with that runner's Node, copies it to `src-tauri/binaries/cadence-cli-<target triple>`, and runs tauri-action, which adds each platform's installers and update files to one release.
- *Tried before tagging:* pull requests that change how releases are built, and runs by hand, build everything without publishing and keep it as workflow artifacts.

*Why:* agents of other projects should get CADence's MCP server with the app, on every major system.
*Trade-off:* every installer is about 120 MB larger; nothing is code signed or notarized yet, so Windows and macOS warn; no installers for Intel Macs or Linux on ARM.

## ADR-52

**What an agent modelling a keyboard enclosure found (CAD-133 to CAD-147).**
- *A kernel that fails is replaced:* when the geometry kernel runs out of memory or traps (`kernelFailure` in Shape Access: out of memory, out-of-bounds memory, unreachable code, a function signature mismatch), every engine call through `guarded` reports it, Shape Access forgets its shapes, and the next call loads a new kernel. Its generation (`Core.kernelGeneration`) tells scripts that the documents open on it have to be read again, and the MCP server says so in the answer of the call during which it happened.
- *The MCP server keeps answering:* it runs the kernel in a Node geometry worker (`serveGeometry`, `restartable` in Messaging) and handles requests side by side. `notifications/cancelled` stops the worker (WebAssembly cannot be interrupted otherwise), the cancelled call gets no answer, and the next call starts a new worker. `check_assembly` reports progress part by part.
- *Schema 3 stops older apps:* the document version goes up with every field an older app must not ignore (`lean`, a sketch's `anchor`, a gear's `chamfer`). A newer document is listed in its project but not opened, with a message to update CADence.
- *Carried over:* project parameters set after a component was opened apply to it on its next change or open; copies of a project keep the version histories of their documents (`copiedFrom`, the ids they had before) and restore them with the copy's ids; `versions` refuses documents of another project.
- *Sturdier modeling:* a boolean leaves out solids of no volume next to its result (CAD-141); a common of bodies on top of each other that comes out empty is tried again with a fuzzy tolerance, and taken empty only when no try gives more (CAD-137), and points are projected onto free-form faces with the tree search, on which a helical gear's flanks no longer trap the kernel; profiles of overlapping shapes whose outlines do not fuse right in the plane are made solid one by one and fused (CAD-138); a STEP file of more than 50 solids is one body (CAD-135).
- *Sketches stay put:* a sketch made on a face keeps the frame the face gave it (`anchor`), so it moves with the face's plane but not with its middle (CAD-136); `move-point` moves a shape's own fix with its point (CAD-144); answers say where a sketch lies, which feature a missing body's face belonged to (CAD-142), and which faces were only renumbered (CAD-139).
- *Gears that print:* the wall check counts a wall only where the ray leaves through a face within 40° of square, so the end of a 45° helical tooth (a 47° wedge) and slivers of a spur gear's end faces no longer read as walls of a hundredth (CAD-143); a gear's teeth can be bevelled at both ends (`chamfer`, CAD-140).

*Why:* an agent modelling a keyboard enclosure through the MCP server lost its session to one failed revolve, waited half an hour for a check, and worked around refused booleans, moved sketches and a desktop app that silently dropped new fields.
*Trade-off:* a restarted kernel builds every open document again (seconds for large parts); the geometry worker copies shapes' bytes for drawing views as before. A 40° limit lets wedges of 40° to 90° pass, which lose up to about a nozzle line at their edge. Newer documents cannot be opened by older apps even when they use none of the newer fields.

## ADR-53

**Projects III: a trash kept in the project's history, notes and attachments as project settings, and the desktop app watching its project folders (CAD-148 to CAD-150).**
- *The trash keeps no copies:* deleting a document first records a version of its project, then removes the document as before and notes it in the project's record (`Project.trash`: id, name, kind, when, and the version that holds its last state). Restoring reads the document (and an imported original) back from that version under its own id and path, so its history continues where it stopped. A deleted project is only marked (`trashedAt`): its folder, documents and history stay until it is deleted for good. What is older than 30 days is deleted for good when the projects or the trash are listed. The trash is a setting of this device, like the remote: it is not in the versions, archives or syncs; a document a pulled version no longer has goes to this device's trash, with the version before the pull.
- *Notes are settings:* the description and the list of attachments are fields of the project, recorded in `project.json` of its versions, in `cadence.json` of archives and taken over by syncs; attached files are assets kept as they are, under `originals/<asset>` in versions and archives like imported originals. Copies give attached files new asset ids.
- *The desktop app follows other processes:* Tauri's fs plugin watches `projects/` (`watch`, debounced by 300 ms, `fs:allow-watch`). The Tauri file system remembers a hash of what it last wrote at each path (or that it removed it), so only changes of other processes are reported, and only documents' files and project records. The composition root turns them into the events other windows already send (`documentChanged`, `documentDeleted`, `projectChanged`, `projectDeleted`): open assemblies and drawings follow as they do for other tabs. Editors follow their own document too: a store whose document changed elsewhere opens it again, unless the user is in the middle of an input (a feature dialog, a sketch, a joint, an annotation); then it asks. New documents are announced (`documentCreated`, relayed between tabs), so lists follow them; the Project Manager gives clients one stream for all of this (`watch`).

*Why:* the owner's open points: deleting must be undoable, a project needs its datasheets and photos, and an agent's edits through the MCP server must show in the open desktop app.
*Trade-off:* a document deleted for good stays in its project's git history (as every earlier version does); restoring a document whose project history was rewritten (another device's sync with conflicts) can fail. Watching reads each changed file once more to compare it. An editor that opens its document again loses its undo history; one that kept editing overwrites the other program's change with its next save.

## ADR-53a

**References between projects: a library part is a read-only copy of a library version inside the project that uses it, linked by the library's own id (CAD-151, CAD-152).**

How a reference between projects is stored and resolved:

- *What is referred to:* a library is a project marked with an id of its own (`Project.library.id`), kept in its settings, so it is the same on every device, in archives and in git; a project's local id is not (each device gives its own). Its parts are its components; documents keep their ids across syncs and archives. Versions are git commit ids, the same wherever the history goes.
- *How it is stored:* the using project keeps the part as a document of its own: the library's document as one version had it, with a new id, and a link (`library`: the library's id and name, the document's id there, the version, and whether newer versions replace it on their own: `follow` `asked` or `always`). What the part uses comes along with links of their own (imported files, fonts and pictures, with their originals), and so do the library's project parameters, as the part's own parameters. Assembly instances, drawings and bills of materials refer to this document like any other, so nothing that reads documents changed.
- *How it is resolved:* updates find the library by its id among this device's projects (not in the trash). A part is behind when the library's latest version (recorded first) changed the part's file or the library's parameters since the version the link names. Updating takes the part again under the same ids, so instances keep pointing at it; open assemblies and drawings read it again (`documentRestored`). A library's new version replaces the parts that follow it always in every project on this device when it is recorded.
- *When the library is not here* (another device, a project opened from an archive): the part still works, since it is a copy; it cannot be updated until the library is here. Archives can carry the libraries (`libraries/<library id>.cadence`, each with its history); opening one adds the libraries this device does not have. A library syncs with its own repository.
- *Read only:* the Design Manager refuses commands on a library part (`library-part`); it changes in the library.
- *Standard parts* are a built-in library (`standard`, version `standard-1`): each catalogue size of the part feature (ISO 4762 screws in their stocked lengths, ISO 4032 nuts, ISO 7089 washers, heat-set inserts, ball bearings) is a component made when it is first used: a part feature at the origin, in steel, named by its designation, which the bill of materials lists. `insert-instance` takes a joint too, so a part goes into a hole in one undoable change.

*Why:* assemblies must use one company bracket or a standard screw in many projects without copying them by hand, and an update must reach every project that uses it, with the version used recorded.
*Trade-off:* the alternative, instances that point into another project's documents, would need every reader (assemblies, drawings, exports, the MCP server) to resolve documents and their results by project and version, and would break wherever the library is missing. Copies take room (a part per project that uses it) and an update rebuilds the part; the read-only rule only holds in CADence (an older app opens a part as an ordinary component, and the next update replaces what it changed). Libraries do not nest (a library's part that is itself from a library is not offered), and sub-assemblies cannot be library parts yet.

## ADR-54

**Reference dimensions: measured from the solved sketch, readable by name (CAD-153).**
- *A flag on a dimension:* any dimension may be a reference (`reference: true`). The Sketch Engine solves without it (it adds no constraint, so it can never over-constrain) and measures it on the solved geometry (`measureDimension`): lengths unsigned, an angle between 0 and 180°. The solution carries the measured values (`measured`), and the sketch's `values` show them, in brackets in the editor. A reference's expression is ignored; made driving again (`set-dimension-reference`), it keeps the value it shows.
- *Offered where a dimension would over-constrain:* the refusal says it can go in as a reference, and the editor offers *Add as a reference dimension*.
- *Read by name:* a reference with a `name` is a parameter that holds what it measures (in mm or radians). Regeneration starts with the values the stored (last solved) positions give, and after each sketch solves, the parameters are evaluated again with what it measured, so everything after it in the timeline reads the new value. A dimension that would use (directly or through parameters) a value measured by its own sketch or a later one is refused: a reference cannot drive what it measures. Names may not repeat a parameter's.

*Why:* makers want to see a length they did not set (a diagonal, a gap) without over-constraining, and to use it (a lid as wide as the box turned out).
*Trade-off:* features before the measuring sketch read the value as last solved, not as solved in this run; parameters cannot drive a dimension of the sketch whose reference they read.

## ADR-54a

**Blocks are sketches; placements are generated geometry (CAD-154).**
- *A block is a sketch marked `block`:* it is edited like any sketch (all tools, relations and dimensions), is not drawn in the model, and its origin is the insertion point. *Make a block of the selection* (`make-block`) moves the chosen points, curves and texts, with the relations among them, into a new block sketch before the current one (a chosen point at the base stays on the block's origin), and places it back where it was.
- *A placement is an entity* (`{ kind: 'block', block, document?, origin, angle, scale }`) like a drawing kept as one piece: each regeneration copies the block's points, curves and texts, turned and scaled about its origin and moved to the placement's point, as generated geometry (`<placement>:<id in the block>`, fixed for the solver). So the block is constrained as one, by its point; relations to its pieces hold other geometry; dimensions within it live in the block. Editing the block updates every placement; `explode-block` turns one into plain curves.
- *Within the project:* a placement may name a block of another component of the project (`document`). That component's stored sketch is read (no regeneration of it); open editors of components that place it follow its `documentSaved`/`documentChanged`, and the results of the others are discarded, so assemblies and drawings ask for them anew. Blocks of a library project ([[CAD-151]]) can be placed the same way once projects refer to libraries.

*Why:* a block as a sketch needs no editor of its own and no new place in the project files: it travels with its component through versions, archives and sync. Generated geometry is how projections and drawings already follow their sources.
*Trade-off:* a block's own relations do not reach into the sketches that place it; a block later in the timeline, or in another component, is placed as last stored (one edit behind within a regeneration, never wrong after it is saved). Blocks that place each other in a loop grow by one level per change (a block never places itself or a sketch that places it directly).

## ADR-54b

**Wrapping and projecting sketches onto faces (CAD-155).**
- *One feature, `wrap`:* profiles of a sketch on a face of a body, raised out of it (`emboss`, joined) or cut into it (`engrave`) by a depth along the face's normal; `method` `wrap` rolls them onto a cylinder or cone, `project` casts them along the sketch's normal onto any face.
- *Wrapped in the face's own parameters:* the sketch plane must lie along the axis; where it is nearest the axis is where it touches. On a cylinder the unrolling is affine in the surface's (u, v), so lines, Béziers (text) and arcs map exactly (arcs become ellipses in (u, v)) and lengths along the surface are kept. A cone rolls out into a sector (distance from the apex, angle × sin of its half angle), mapped with Hermite cubics through the mapped points and tangents; its apex and axis are read from points on it, as the kernel build reads no cones. The outlines are laid on the surface (replicad `sketchOnFace`, native parameters) and thickened (`MakeThickSolidBySimple`).
- *Projected through a prism:* the profiles extruded through everything along the sketch's normal, met with the face thickened by the depth; where the prism passes the face twice (both sides of a cylinder), only the solids nearest the sketch's front are kept.
- *Not touching the body's face:* the tool starts a hundredth of a millimetre on the far side of the face (inside for an emboss, outside for an engrave), so it adds or removes nothing there, and booleans of touching cones do not fail. Its faces are `f:<wrap>:top` (the depth away), `base` and `side`.

*Why:* labels, grips and scales on round parts are common in printing; rolled onto the exact surface they stay true to size and smooth, without approximating the round face.
*Trade-off:* a wrap needs a sketch plane along the axis, and wraps at most once round; a cone's lengths are exact only for a plane that touches it along a line. Projected profiles are not kept true to size. Many letters make many faces, so text takes a second or two to build.

## ADR-55

**Part modeling IV: ribs up to the next face, drill points, nested folders, repairs by shape, a material per body (CAD-156 to CAD-158).**
- *A rib up to the next face is the gap it fills:* its outline is extruded from the sketch plane past everything there is (each way when symmetric), the bodies are cut away from it, and what is left from the plane to where it first meets them is the rib (`ribToNext` in [[src/core/engines/modeling/draft-rib.ts]]). So it ends on any face it meets, flat or curved, and fails with a reason when part of it meets nothing.
- *A drill point is a cone below the depth:* a blind hole's depth stays the depth to the full diameter (as drawings give it), and `drillPoint` adds a cone of `pointAngle` (118° when empty) below it, named `f:<feature>:point:<point>`; hole callouts say "depth 12, 118° point".
- *Folders nest by their items:* a folder still runs from one item to another, and two folders are apart or one holds the other, so nesting needs no field of its own (`nestFolders` works out each folder's parent and depth; of two with the same items the earlier holds the later). `move-folder` moves a folder's items with the folders inside it, and like a moved item it is in whichever folder it is dropped into.
- *A reference remembers what it was:* the Design Manager records the shape of each face and edge a command names, as the bodies are then (`TopologyRef.shape`: the kind of surface or curve, its area or length, its radius; Analysis Engine `shapesOf`). A repair ranks the faces or edges of the lost one's kind by unlikeness in shape (another kind counts 1, plus the relative differences in size and radius) twice as much as by distance across the model, so a fillet's lost edge finds the edge of the same size before the nearest one; `sameShape` marks those that match.
- *Bodies have their own material:* `ComponentDocument.bodyMaterials` maps body ids to materials, and the component's `material` is the default for every other body. Mass properties weigh each body by its own density, the strength check solves each body with its own stiffness and gives the smallest of the bodies' safety factors, bills of materials and parts lists name every material of a part ("PLA, Steel"), and 3MF exports carry base materials and OBJ exports material names.
- *Schema 4:* nothing to migrate; it marks documents whose drill points, ribs up to the next face, nested folders and bodies' materials an older app would ignore.

*Why:* ribs between walls, holes as a drill leaves them, long timelines grouped in levels, repairs that pick the like edge rather than the nearest one, and a steel shaft in a plastic housing were the open points the owner chose (CAD-148 to CAD-181).
*Trade-off:* a rib up to the next face needs a boolean of a long tool with all bodies (slower than a set depth); shapes are recorded only for references a command adds from now on and only where the bodies at the rollback marker have them, so older references are matched by distance alone; STEP exports do not carry materials; a body's material entry stays when the body goes, until it is set back.

## ADR-56

**Gears and springs: shifted, bevel and worm gears from involutes, springs and helices swept in one piece (CAD-159, CAD-160, CAD-161).**
- *Profile shift:* a gear's teeth are generated by a rack moved x·m out (`shift`): half a tooth spans π/2z + 2x tan α / z + inv α − inv α(ρ) at radius ρ, tips and roots move x·m out, and the root fillet stays below the mating rack's tip line, pitch − (1 − x)·m. `centreDistance` solves inv αw = inv α + 2 tan α (x₁ + x₂)/(z₁ + z₂) for meshing without backlash, and `minimumProfileShift` (1 − z sin²α / 2) is the shift that keeps the whole involute; the test rolls the cutting rack along an 8-tooth gear and finds it no deeper in the teeth than the flank curves stray from the involute. The tips are not shortened for the mate: with x₁ + x₂ > 0 the tip clearance is a little less than 0.25 m.
- *Ring gear root fillets:* the corners of a ring's tooth spaces at its root circle are rounded by the largest circle (at most 0.38 m) inside the space that touches the root circle and the involute flank beyond the planets' tips (pitch + m). Its centre lies on the flank point's normal, which touches the base circle, so it is found by bisection along the flank, not by intersecting curves.
- *Bevel gears:* the teeth are those of the virtual spur gear on the back cone (Tredgold: z / cos δ teeth of the same module), laid onto the sphere about the cone's apex and seen from the apex on the plane of the large end; extruding that outline towards the axis while scaling it linearly to the apex (`bevelTaper`, a law sweep) gives a gear whose every section is right. Ends are flat, not back cones. `bevelMesh` gives both pitch cones, the apex and where the mate's large end goes, turned so a space faces the gear's tooth; a 20 : 30 pair at 90° overlaps by 0.01 mm³ and by 12 mm³ at 1° off.
- *Worms and wheels:* a worm is a core with `starts` trapezoidal threads (its axial section a rack of module m) swept along a helix of lead starts·π·m with the profile kept upright about the axis, centred on its plane, a thread crossing the plane on its u axis; its pitch diameter follows from the lead angle. The wheel is a crossed helical gear at the lead angle (same hand), turned so a space faces −u halfway up: point contact, not a throated (enveloping) wheel, which would need a hob simulation. Booleans of worm and wheel flanks that overlap fail inside the kernel; meshed they come out clean.
- *Springs as one sweep:* each spring's whole centre line (coils, closed ends that ease from flat into the pitch, extension springs' loops, torsion springs' legs) is one B-spline through its points, swept by a circle with a discrete trihedron, so no boolean joins coils, loops and legs: fusing a swept coil with anything lost the coil, and a binormal fixed along the axis folds the pipe where a loop runs along it. Coils that touch are kept 2 % of a wire apart; ground ends are cut flat by one common with a cylinder.
- *Spring rate:* `springProperties` gives k = G d⁴ / (8 D³ nₐ) with G = E / (2 (1 + ν)) of the component's material, or E d⁴ / (64 D nₐ) for torsion springs, and the free and solid lengths of the end types; the Design Manager adds it to the properties of bodies made by a spring part (`Derived.springs`).
- *Helpers apart from types:* `centreDistance`, `bevelMesh`, `wormMesh`, `planetaryRatios`, `springProperties` and `helixPoint` live in [[src/core/contracts/mechanics.ts]], not with the part and feature types, so the command reference's `features` topic stays short enough for an agent to read whole (under 30 000 characters).
- *Helices are features without bodies:* like construction planes, a helix feature only resolves (its plane, diameter, pitch, turns or height, taper) into a `HelixPath`; a sweep whose path names it gets an exact helix (a line on a cylinder, or a cone when it tapers) and keeps its profile upright about the axis; patterns along a path stay with sketches.
- *Schema 4:* a gear's `shift`, the new part kinds, the helix feature and the bevel and worm link kinds are fields an older app would drop or misread, so the document version goes up (nothing to migrate).

*Why:* the owner asked for root fillets on ring gears, shifted gears, bevel and worm drives with where their mates go, and springs with their rates.
*Trade-off:* the kernel's memory fills quickly with worm and wheel booleans (their tests run in spec files of their own); worm wheels touch at points; bevel gears have flat ends; extension springs get side loops only; a torsion spring's legs go on along the coil, not in chosen directions.

## ADR-57

**Sheet metal II: every flange is a section of bends and straight pieces; the flat pattern unfolds flat piece by flat piece; reliefs are cut where two flanges meet; the schema goes to 4.**
- *One section for every flange.* An edge flange, a hem and each piece of a miter flange are a list of bends (angle, inside radius), each followed by a straight piece, walked into a cross-section square to the edge ([[src/core/utilities/math/flange.ts]]): the kernel extrudes it along the edge and joins it, the flat pattern lays it flat. A hem is half a turn round half its gap (closed: no radius), or for a teardrop as far as it takes the straight piece's end back down to a tenth of the thickness above the sheet: touching the sheet along a line would split the face below it and its edges. A miter flange's profile is a sketch of straight lines square to one of its edges: each line a straight piece as long as the line, after a bend of the sheet's radius by the angle the line turns (the first from the sheet), like an edge flange's length and angle.
- *Miters.* Pieces of a miter flange meet in the plane halfway between their edges: each is extruded past its edge's ends and trimmed by that plane. Its marker says how far it reaches past each end per millimetre away from the edge, so the flat pattern cuts each piece's ends along the neutral layer.
- *Flanges on flanges.* A flange records the edge it stands on, the directions away and up, and its pieces (`FlangeMarker`). The flat pattern keeps a flat *panel* for the base flange and for every straight piece of every flange: how points of that piece map into the pattern. A flange is laid flat from the latest panel that holds its edge, so flanges and hems on flanges unfold in turn, and its strip replaces that panel's outline edge as before.
- *Corner reliefs* are one of the sheet's rules, on the base flange. Where two flanges' edges share an end on the same face and neither end is mitred (`flangeCorners`), the flat pattern takes a round (of the size's diameter) or a square (of its side) centred on the corner out of the sheet and the bends' ends, or cuts a tear: the size's length into the sheet, halfway between the flanges, nothing removed. The feature that makes the second flange of a corner cuts it from the solid too: a prism of the shape through the sheet, as high as the bend radius, its faces named `f:<feature>:relief:<n>`.
- *Schema 4.* An older app would show documents with hems, miter flanges or a corner relief wrongly, so the version goes up; there is nothing to migrate.

*Why:* one kind of section covers flanges, hems and miter flanges, keeps the kernel's solids exact and named, and keeps the flat pattern analytic, with no unfolding algorithm in the kernel. Panels make flanges on flanges the same mapping applied again instead of a special case.
*Trade-off:* the 3D relief is a straight prism, so in the bends it is close to, not exactly, the flat cut bent up (the flat pattern is the one to cut); a tear removes nothing in 3D. Miters have no gap between pieces and are cut along the neutral layer in the flat pattern. Miter flange profiles are straight lines; a flange stands on one flat piece (not across a bend), and reliefs need the two flanges on one face.

## ADR-58

**Drawings III: stepped and half cuts by boxes, ISO 286 tables in the drawing layout, threads drawn from markers that results carry, outlines found per surface type, named parts of assemblies, and exact views finished in a second views kernel (CAD-164 to CAD-168).**
- *Offset and half sections* stay one `section` of a view: `steps` say where across the view (along its right or up, from the model's middle) the cutting plane moves to another depth, `half` keeps only the pieces right of (above) the middle. The engine cuts with one box per piece instead of one half space; cut faces are the faces on a piece's plane within its stretch, and the step's own edges (lines along a turn with hatching on a side) are not drawn. The parent view's cutting-plane line follows the pieces, thick at each turn; a half section draws its centre line, and its cutting line runs from the middle out. `sectionPieces` lives in the contracts, so the engine and the layout cut alike.
- *Tolerances* belong to the dimension (`tolerance`: ±, deviations, limits, an ISO 286 class or fit): limits follow the measured size when the model changes. Fits come from tables of the standard (IT5 to IT12, holes D to P and JS, shafts d to p and js, up to 500 mm), with the Δ of K, M, N and P, in the Drawing Manager; text stays horizontal and Latin-1 (`-` for minus) so the PDF and DXF show it. A *surface finish symbol* (ISO 1302) is an annotation of its own that stands on a line anchor or sits free with a leader.
- *True lengths:* a length on an isometric view between two anchors with model points is measured in the model; `axis` measures along a model axis and draws along that axis as the view shows it, extension lines along the other axis most across it. Anchors without model points (extremes) fall back to the sheet divided by the axis's foreshortening.
- *Cosmetic threads* (ISO 6410) are drawn from thread markers, which component results now carry per body (`threads` in the snapshot, set by the Design Manager, moved with placed assembly parts), so a drawing needs no timeline. Thin lines at the minor (shaft) or major (hole) diameter and a thick end line from the side, a thin three-quarter circle along the axis; seen or hidden as the face they are on is. A *modelled* thread's groove is filled again before projecting: a cylinder a little wider than the groove, turned down or bored out to the face and cut back past the open end, so no tool touches the helical flanks; the 460 s view of ADR-49 takes about a second. Threads offer their circle (`thread:<feature>`) for callouts and their thin lines for diameters.
- *More anchors:* cones' outlines come from sampling their normal round the face (the kernel's cone and torus types are not bound in its WebAssembly; cylinders and spheres are), tori seen along their axis give rims from points on them, other round faces the outermost points of their outline from their triangles (seen within a looser tolerance). Placed assembly copies keep their names in topological order, and assembly views prefix them with the instance (`<instance>/<name>`).
- *Exact views in the background:* a view that ran out of time in the views kernel is drawn from the triangles at once and queued for a second views kernel (`exact`, `stoppable` without a limit, stopped after a minute idle). The Drawing Manager runs the queue one view at a time for all its drawings, skips views no longer shown, stores each exact view in the drawing's result (also when the drawing was closed meanwhile) and lays the sheet out again; until then the view's note says it is still being drawn.

*Why:* the owner's open points after phase 22 and ADR-49: drawings for workshops need offset and half sections, fits and finishes; a modelled thread blocked views for minutes; agents could not dimension cones, spheres or a part of an assembly; approximate views stayed approximate.
*Trade-off:* only planes across the view cut (no aligned sections); ISO 286 without r to zc and IT13 and above; text is never turned along an edge; a thread that a cut takes away wholly is left out, but one it cuts partly is drawn on its whole length. Results published before this phase carry no threads until their component changes. The exact kernel is a third kernel while it works, and a long exact view holds the queue for the views after it.

## ADR-59

**Import II: large and broken meshes become solids after a repair and a decimation kept as a file of its own; KiCad boards are read in TypeScript and built as two solids with named holes (CAD-169, CAD-170).**
- *Repair before every mesh-to-solid* ([[src/core/engines/interchange/mesh-repair.ts]]): corners closer than a millionth of the mesh's size merge, triangles with two equal corners and second copies go, triangles are turned by a walk over shared edges so neighbours agree, each closed piece is turned outwards by the sign of its volume, and each opening is closed by a fan to the middle of its border (a triangle for three corners). A sound mesh comes back unchanged, so existing imports keep their solids and names.
- *Decimation by quadric error* ([[src/core/engines/interchange/decimate.ts]]): Garland and Heckbert's error quadrics in the threshold form of Forstmann's *Fast Quadric Mesh Simplification* (no heap: each pass collapses every edge under a threshold that grows with the pass), in a box of size 1 so thresholds mean the same for every mesh, with a link-condition check so collapses never pinch the mesh into edges of three triangles, and edges on an opening only collapsing along it. Measured: a 500,000-triangle scan to 20,000 triangles in under 2 s in Node, to a solid in about 3 s more.
- *A simplified copy, not a setting:* the imported viewer previews the repaired and simplified mesh (`previewSimplified`) and keeps it as a new imported file in the original's format, "<name> (simplified)" (`simplifyImported`); the original stays as it is, and the 100,000-triangle limit of [[#ADR-22]] stands for what becomes a solid. No document field is added, so the schema stays at 3.
- *KiCad boards* (`.kicad_pcb`, KiCad 6 and newer; [[src/core/engines/interchange/kicad.ts]]): a small S-expression reader that passes over tracks, vias, zones and nets unread (an 11 MB keyboard board reads in about 0.1 s). Edge.Cuts pieces (lines, three-point arcs, circles, rectangles, polygons, Béziers as lines; on the board and in footprints) chain into loops within 1 µm; the largest is the outline, loops inside it are cut-outs. Drilled pads (round or oval) are holes; vias are left out. Footprints are placed with KiCad's rule (pad angles in the file include the footprint's), Y turned up.
- *Two solids per board* ([[src/core/engines/interchange/board.ts]]): the board is one face (outline with every hole and cut-out as an inner wire, circles running clockwise) extruded by the board's thickness, from its outline's lower left corner at the origin with its bottom on the XY plane; when holes touch, it is cut instead. Its faces are named in Shape Access (`board:top`, `board:bottom`, and each hole's wall `hole:<reference>` or `hole:<reference>:<pad>`), and the Modeling Engine now keeps names a file gives when it inserts it. The parts are one more solid, a compound: each part is its STEP model where the project holds a STEP file named like the model (any folder or extension; placed with KiCad's offset, rotation and scale, turned over on the bottom), else its courtyard (fabrication outline, pads) extruded by its `Height` field or 3 mm, up from the top or down from the bottom. Mounting holes (a part that is one hole) and board-only footprints are no parts.
- *Parts found by the managers:* the Project, Design and Assembly Managers ask the engine which models a board names (`partFiles`), fetch the project's STEP files of those names and pass them with the board (`readSolids(…, parts)`); the solids' key includes those files, so a STEP file imported later is used the next time the board is read.

*Why:* scans and downloaded models are far above 100,000 triangles and often open; an enclosure is designed around a board, with screws through its mounting holes.
*Trade-off:* a fan closes an opening well only when it is roughly flat and convex; an inner shell (a hollow scan) is turned outwards like any closed piece. Copper (pads, tracks, zones) is not modelled; parts without a height or a model are 3 mm tall boxes; KiCad 5 files (arcs by angle) are not read. A large board takes a few seconds to build and to tessellate (the keyboard: 2 s and 9 s, 180,000 triangles for its 480 holes).

## ADR-60

**Scripts run in a JavaScript engine of their own: QuickJS in WebAssembly (CAD-171, CAD-173).**
- *A sandbox, not a module:* `run_script`, the app's script console and plugins run JavaScript in QuickJS compiled to WebAssembly (`quickjs-emscripten-core` with the single-file browser build, which also runs in Node), behind the Sandbox utility ([[src/core/utilities/sandbox/index.ts]]). A script sees only what is put into its engine: `cadence`, its parameters (`params`, `args`) and `console`; no Node, no DOM, no network, no files, no `eval` of the host. Each run gets its own runtime with a memory limit (256 MB), a stack limit and a time limit: an interrupt stops loops that never wait, a timer stops scripts that wait too long.
- *The API through a membrane:* `cadence` inside the sandbox is made of stand-ins built from one list of the members a script may use ([[src/automation/script-api.ts]]); every call goes to the host as JSON, which calls the real scripting API ([[src/automation/script.ts]]). Components, assemblies, drawings and the project manager come back as handles, plain data as copies, bytes as base64. So every call returns a promise (`await` it), and members the list leaves out (the kernel's `stop`, `forget`, a session's internals) do not exist inside. `to` paths of exports must lie in the exports folder: no files outside it.
- *What a run answers:* the value the script returns, what it printed, and the documents it created, changed or deleted (by their times and by the deletions it asked for).
- *Where it runs:* the command line and the MCP server run the engine on their own thread (it is interrupted by its time limit, and by a cancelled call); the app runs it in a Web Worker, which **Stop** ends, while the API calls are answered on the main thread by the app's own core. `cadence run <file>` keeps running trusted script files as Node modules, with the whole API.
- *Kept with the project:* scripts the app keeps are part of the project (`Project.scripts`: name, source and parameters with defaults), saved, versioned and synced with it; a run asks for the parameters first, so one script makes a part in many sizes.

*Why:* agents wrote loops and calculations a call at a time (the radial engine's 26 sheets of dimensions went through the command line), and a script from an agent or a shared project must not reach the computer it runs on. Node's `vm` is no security boundary, and a browser worker running `new Function` would need `unsafe-eval` and still reach the network and IndexedDB.
*Trade-off:* about 1 MB of WebAssembly, loaded when the first script runs; QuickJS is slower than V8 for heavy arithmetic (geometry still runs in the kernel); scripts must `await` every call, even `summary()`. Rejected: `vm` in a worker thread (escapable through any host object), SES/Compartments (a large dependency for the browser and Node alike, no time limit for loops).

## ADR-60a

**Plugins: one JavaScript file, installed into a project, run in the script sandbox (CAD-174).**
- *Format:* a plugin is one JavaScript file (`*.cadence-plugin.js`) whose body returns the plugin: `return { id, name, version, cadence: 1, features, generators, exporters }`. `id` is lower case (`acme.trays`), `version` is semantic (`1.2.0`), `cadence` is the plugin API it was written for. Each feature, generator and exporter has a `label` and `parameters` (`{ name, label, default, kind }`, `kind` one of `length`, `angle`, `number`, `text`).
- *What each part may do (its API):* a **feature** is a pure function `build(values)` from its parameters (lengths in mm, angles in degrees) to solids: closed outlines in the feature's plane (`outline`, optional `holes`, points in mm), each extruded by `height` from `z`. A **generator** is a script, `run(cadence, params)`, with the scripting API of ADR-60. An **exporter**, `export(model)`, turns a component's triangles (`{ name, bodies: [{ id, positions, indices }] }`, mm) into the text of a file. Features and exporters get no API at all.
- *Engine hooks:* a plugin feature is a timeline item of its own (`type: 'plugin'`, the plugin and its version, the feature's name, a plane, parameters as expressions, a body operation). The Design Manager evaluates the expressions with the component's parameters on every regeneration, asks the Plugin Engine ([[src/core/engines/plugin/index.ts]]) for the solids, and builds them with the Modeling Engine's ordinary extrudes; a feature's solids are cached by plugin, version and values. So a plugin feature regenerates like any other, and its faces are named by the feature and the outline's edges. A component with a plugin feature needs document schema 4.
- *Installed into a project:* `installPlugin` (the app's Scripts panel, `cadence install-plugin`, the MCP tool `install_plugin`, the scripting API) reads the plugin's description in the sandbox, checks it, and keeps the source with the project (`Project.plugins`), replacing an older version of the same id. The project carries its plugins wherever it goes (versions, git, `.cadence` archives), so its components regenerate in the app and in the MCP server alike.
- *Versions:* the app runs plugins written for plugin API 1 and refuses others. A feature records the plugin version it was made with; a plugin of another major version refuses to build it, with both versions in the message, until the feature is made again.
- *Sandboxing:* all plugin code runs in QuickJS (ADR-60): a feature's build is limited to 10 s and 64 MB; a generator to the time its run allows.

*Why:* features, generators and exporters others write should load in the app and the MCP server alike, regenerate with the parameters, and never reach the computer through a shared project.
*Trade-off:* plugin features make solids from outlines and heights only (no fillets of their own; later features can add them); the source is copied into every project that uses it, so updating a plugin means installing it again per project. Rejected: plugins installed per app (a project would not regenerate elsewhere), plugins as npm packages (no sandbox, Node only).

## ADR-61

**Versions compared and merged by the items of a document (CAD-175, CAD-176): a Revision Engine, a Modeling Engine comparison of bodies, and git sync that asks per item.**
- *One model of a document's items:* the Revision Engine ([[src/core/engines/revision/revision.ts]]) knows which lists of a document have items with an identity: a component's timeline (sketches with their elements and relations inside), parameters (by name), folders, configurations and appearances; an assembly's instances, joints, studies, patterns, links and exploded views; a drawing's views and annotations; a project's settings (its parameters). Every other field is one value. Ids, project, kind and dates are bookkeeping and never differ. Pure and synchronous, like the Sheet Metal Engine.
- *Compare:* `compareDocuments(before, after)` lists what was added, removed, changed (with the fields, before → after) and moved (not in the longest run both orders share), each with a path (`timeline/e2`, `timeline/s1/entities/c3`, `parameters/width`) and a label. The Project Manager's `compareVersions(document, from, to?)` reads both versions (migrated, with the project's parameters of each), and the Design Manager's `compareBodies` builds both and asks the Modeling Engine's `compare`: each body of one version cut by all of the other's, kept where more than 0.001 mm³ is left, as meshes with volumes. The editor shows them in place of the component (overlaid: both see-through, added green, removed red; or side by side), with the list; agents get it in words (`versions` with `compare`).
- *Three-way merge:* `mergeDocuments(base, mine, theirs)` takes, per item and per field, the side that changed it; both alike: once; both differently (or changed here, deleted there): a conflict with its path, decided by `resolutions` or reported with how each side has it. A sketch both changed is merged element by element, then cleaned of relations and curves left on elements the other side deleted (as deleting them would). Items one side added go after the item they followed there, ours first; the order of shared items is theirs when only they reordered. The merged document gets a new `modifiedAt`, so results of either side are stale.
- *Git sync uses it:* a document (or `project.json`) changed on both sides is merged item by item; only when items conflict is it reported, as `SyncConflict.items`, and chosen per item (`<path>#<item path>`), or for the whole document (`<path>`) as before. Documents deleted on one side and changed on the other, and those of a newer schema, are still chosen whole.

*Why:* two people adding features in two places of one part is the common case, and picking one side threw the other's work away. Ids are already stable (commands carry them, ADR-10), so items can be matched without diffing JSON text.
*Trade-off:* a feature is one item: one side changing its distance and the other its name is a conflict, not a merge (its fields depend on each other). A merged timeline may refer to something the other side deleted; it then fails as any broken reference does and is repaired the same way. The body comparison regenerates both versions (seconds for large parts).

## ADR-61a

**Users, sharing and real-time collaboration (CAD-177, CAD-178): a small self-hostable CADence server, whose relay orders commands.**

CADence has no server. Versions are a git repository per project, synced with any git host ([[Architecture/Decisions#ADR-30]]), and every document changes only through commands. Accounts, shared projects and live editing each need something running somewhere; these are the ways to get it.

*Where accounts and shared projects live:*

| | A. Git hosts are the accounts | B. A small CADence server, self-hostable | C. A hosted backend service |
| --- | --- | --- | --- |
| What | Sign in with GitHub, GitLab or Gitea (OAuth). A shared project is a repository; view and edit are its read and write access; the host's own sharing invites people. | One Node program in this repository (`server/`, a Docker image): accounts, projects stored as git repositories, members per project (owner, editor, viewer), share links, and a WebSocket relay. | Supabase, Firebase or a collaboration service (Liveblocks, PartyKit): accounts, storage and live rooms run by a vendor. |
| Sign-in | OAuth of the host. Browsers need a tiny token exchange (a serverless function: GitHub's OAuth endpoints allow no CORS); the desktop app and the command line use the device flow. | OAuth with GitHub and Google (plus an e-mail link for people without either); its own sessions. A test provider for journeys. | The vendor's sign-in. |
| Shared links | `…/open?remote=<repository>`: anyone can view a public repository; a private one asks to sign in. | `…/s/<token>` opens a read-only view in any browser, no account needed; editor links ask to sign in. | The vendor's rules. |
| Storage | The git host (free, backed up there). | The server's disk: bare git repositories, so ADR-30's sync works against it unchanged; one file for accounts and members. | The vendor's database and file storage. |
| Real time | Not possible through git alone: needs a relay anyway (B's relay, or C). | The same server relays commands. | Built in (Liveblocks, PartyKit) or with realtime tables (Supabase). |
| Cost | Free; the token exchange fits free tiers (Cloudflare Workers, Netlify). | A small VPS, about 5 € a month, or free on the owner's own machine; backups, updates and security are the owner's. | Free tiers, then per user or per connection; moving away later means rewriting this layer. |
| Fits | People who already use git. Nothing of ours to operate. | Everything in one place we control, offline-first apps that sync to it, and agents through the same API. | Least code, most lock-in; projects leave the owner's hands. |

*How live editing is ordered (CAD-178):*

| | 1. Commands through a relay that orders them | 2. A CRDT of the document (Yjs, Automerge) | 3. Operational transforms of commands |
| --- | --- | --- | --- |
| How | Clients send commands; the relay gives each a sequence number; a client applies the others' commands and replays its own pending ones on top (the commands are pure functions of the document). A command that no longer applies (its item was deleted) is dropped and reported. | The document becomes a shared map and arrays keyed by ids; changes merge on their own, without a server deciding an order (also peer to peer). | Each pair of command types gets a transform, so concurrent commands are rewritten against each other. |
| Offline | Pending commands wait; on reconnect the three-way merge of [[CAD-176]] combines the offline document with the live one. | Native: changes merge whenever peers meet. | Like 1, with a longer log to transform. |
| Valid documents | Always: each command is checked by the Design Manager as today (solving, conflicting constraints). | Not guaranteed: two valid edits can merge into a sketch that does not solve; checked and repaired after merging. | Valid if every transform is right. |
| Cost to build | Small: the commands exist; a relay of a few hundred lines; presence (who edits where) as a separate small message. | A second representation of every document kind, kept in step with the schema; about 70 KB more for Yjs. | Large: more than 60 command types, so thousands of pairs. |

*Recommendation:* **B with 1**: a small self-hostable server (git repositories as storage, so sync keeps working with any git host as well; GitHub and Google OAuth; members and share links) whose relay orders commands, with the three-way merge of [[CAD-176]] for offline catch-up. It is the only option that gives CAD-177 and CAD-178 one home the owner controls without a vendor. Its cost is operating a server; A is the fallback when that is not wanted (sharing works, live editing does not).

*Decision (the owner, 2026-10-21):* **B with 1**, as recommended. Built as follows ([[Architecture/Server]]):
- *The server* (`server/`, built to `dist/server/server.mjs`, a Docker image in `server/Dockerfile`) is a host of its own beside the app, not part of `src/core`. Accounts, sign-ins (kept as SHA-256 hashes of their tokens) and projects with their members and links are one JSON file, written whole through a temporary file: enough for one workshop or club, and no native database module to build. Projects are bare git repositories served by git's own `http-backend`, so ADR-30's sync works against it unchanged; its sign-in is a member's token or a view link as password, members fetch and editors and owners push. Browsers reach it directly (it answers cross-origin requests), so no CORS proxy.
- *Sign-in:* OAuth 2 with GitHub and Google (authorization code, client secrets on the server), sending people back to the app with the token in the address's fragment, which the app takes out before routing; on a private network, signing in by name (`CADENCE_DEV_SIGN_IN=1`, also used by the tests). Return addresses must be on the app's origins.
- *Sharing* (CAD-177): Server Access (a Resource Access over the server's API) and the Project Manager (`shareProject`, `setMember`, `addViewLink`, `openShared`, `openViewLink`, …). A shared project's remote names its server, project and role; a link opens the project here to view, its syncs only taking versions.
- *Live editing* (CAD-178): the relay (`/live/<project>/<document>`) numbers what clients send and streams it as server-sent events, read with `fetch` (no WebSocket server needed); it keeps the entries since a snapshot clients send when asked, and a client's resent payload (same `ref`) once. The Design Manager's session (`goLive`, [[src/core/managers/design/live.ts]]) applies changes made here at once and keeps them pending until they come back; others' are applied in the relay's order and the pending ones run again on top, dropped (for everyone) when they no longer apply. An undo is sent as the whole document. Offline, changes wait and are sent on reconnecting; back from behind the room's snapshot, the client merges three ways (ADR-61), keeps theirs for conflicting items and says so. Presence (who is where, the pointer in a sketch) goes beside the entries.

*Trade-off of the build:* rooms live in the server's memory (a restart lets the first client back start the room from its document); live editing covers components (assemblies and drawings sync through versions); someone undoing live may undo others' concurrent changes made since. The server needs git; OAuth needs an app registered with GitHub or Google per installation.

## ADR-62

**Anywhere: a viewer layout for phones, glTF and USDZ for augmented reality, a tour that watches the page (CAD-179 to CAD-181).**
- *A layout, not a second app:* below 720 px wide (or 500 px high on a touch screen) the editor is a viewer (`Layout` in [[src/app/shared/layout.ts]], one media query). The modes leave out the modelling tools, the browser and the properties panel, and show a bar of touch tools (`PhoneBar`): documents in a drawer, fit, home, measure, AR. The measure panel becomes a sheet over the bottom of the model. Touch itself is three.js's OrbitControls (one finger turns, two pan and pinch); the viewport only learnt that a gesture of two fingers picks nothing when they lift.
- *The shared viewer is touched too:* the self-contained HTML viewer ([[Architecture/Decisions#ADR-33]]) follows every pointer: one turns (or pans), two pan by their middle and zoom by their spread, a tap measures; on small screens its panel sits at the bottom with the parts folded away.
- *Files at real size, written by a utility:* `glb` and `usdz` in [[src/core/utilities/scene/index.ts]] take the same model as the HTML viewer (`viewerFile(format)` on the Design and Assembly sessions, `exportViewer(format)` delivers it, MCP formats `glb` and `usdz`). Both are metres with Y up, each part's transform and colour (linear) applied, one mesh and material per part; USDZ is a USDA stage in an uncompressed zip whose data starts at a multiple of 64 bytes (`zip(files, { align: 64 })`). No three.js exporters: the core stays free of three.js and the files can be made in Node; tests read them back with three.js's GLTFLoader and USDLoader.
- *AR where the device has it:* Safari (`<a rel="ar">`) opens the USDZ in Quick Look; elsewhere WebXR's `immersive-ar` with hit testing places the glTF where a ring marks a surface (a WebGL renderer of its own, loaded only then, since WebXR renders through WebGL). The button shows only where `arSupport` finds one of the two.
- *A tour that watches, not a script that drives:* each step names its target (`data-tour`) and what the user's action brings up (a selector); the card moves on when that appears and passes over steps already done. It starts by itself on the first start only, never in an automated browser (`navigator.webdriver`), so tests opt in; Skip or the end are kept in local storage. The card stays docked in a corner, off the menus its buttons open, and blocks nothing.
- *Samples are the templates:* the home page lists the shipped templates ([[Architecture/Decisions#ADR-33]]) as samples, opened as projects of one's own. Help links are one table of topics (a User guide page and heading each, [[src/app/shared/help-topics.ts]]) that a test checks against the guide's headings.

*Why:* models are looked at, measured and shown on phones far more often than they are made there; a viewer layout over the same editor keeps one app, one set of documents and one way into the managers. New users met an empty project and no guidance.
*Trade-off:* no modelling on phones. USDZ and glTF repeat the geometry of each instance (no shared meshes) and leave out edges. Quick Look and WebXR cannot run in CI: the journeys stand in for Safari's link and for `navigator.xr`, so a real placement is checked by hand. The tour covers the first part only, and its steps name selectors that the UI must keep.

## ADR-63

**Joints you can drive: held joints, limits that say so, offsets that follow parameters (CAD-184 to CAD-186, CAD-195, CAD-197, CAD-198).**
- *Held joints are the solver's driven set, made visible:* the kinematic solver always kept the joints a change asks for at their values while it closed loops ([[src/core/engines/kinematics/kinematic-solver.ts]]). `set-joints` puts several joints in that set at once, and a joint marked `driven` (an actuator) is in it whenever anything is solved, so a parallel mechanism's legs keep their lengths and set the plate's pose. A driven joint that closes a loop adds its distance from its values to the loop's residual, so it holds wherever the spanning tree puts it. A change whose held joints cannot all hold is refused, with how far the loop stays open.
- *Limits report, they do not refuse:* clamping stays (values, keys and drives are held at a limit, as before), but the solver returns where a limit held a joint (`holds`: the freedom, min, max or cone, the value and what was asked of a driven joint). The assembly's state carries the holds of its pose and the notes of the last change (keys and drives of a study past a limit); studies return the first moment each limit held. Answers to agents and the joint's panel say it in words; keys past a limit are marked.
- *Cones and universal joints:* a cone limits the angle between B's z and A's. For a ball (yaw, pitch, roll) and a universal joint (about x, then y) that angle is acos(cos·cos) of its two tilting turns, so the cone scales both down together and leaves the ball's yaw free. A universal joint in a loop also rules out its spin about its own axis.
- *Expressions next to numbers:* a joint offset keeps its numbers, which every reader of offsets uses unchanged, and may carry `expressions` of the project's parameters (`x`, `y`, `z`, `lean`, `tilt`, `angle`). The Assembly Manager evaluates them with the Parameter Engine (a new dependency) on every change and when the project's parameters change, and keeps the numbers they gave. An `axis` (and `xAxis`) direction replaces lean and tilt for agents, who think in directions.
- *Numbers are checked at the door:* every joint's values, limits, offsets and cone, and every transform, must be finite numbers, and a change that would put an instance at a position that is not a number is refused. Undo and redo with nothing to undo or redo are errors to agents, since a new server process has no history of changes made before it.

*Why:* the robot arm and the Stewart platform ([[Robot arm]], [[Stewart platform]]) showed that a joint offset in text moved a chain to nowhere, that a parallel mechanism could not be driven by its legs, and that limits held joints without a word.
*Trade-off:* expressions are evaluated by the manager, not by the solver, so an offset that follows a parameter changes the document when the parameter changes (a save without an undo step). Held joints can make a mechanism that would otherwise close refuse a change: setting one leg of a platform whose other legs are driven moves the plate as far as five fixed legs allow, or nothing. The cone is exact only for joints whose tilt is their two turns' cosines; other joints have no cone.

## ADR-64

**Motion: inverse kinematics, carried parts, a study's numbers, joint loads (CAD-187 to CAD-189, CAD-196).**
- *Targets are residuals of the loop solver:* reaching a target is the same damped least squares that closes loops ([[src/core/engines/kinematics/kinematic-solver.ts]]), with the target's distance and directions as more residuals. Only the joints between the ground and the targets' instances (and those leading to loops) move, so a gripper's fingers stay. One solver serves open chains (the robot arm) and closed ones (the Stewart platform's plate gives its legs). Actuators move when reaching; `hold` keeps joints. A target out of reach is not an error: the answer is the nearest pose and how far off it stays (`miss`). It starts from the joints' values, so the branch (elbow up or down) is the one the assembly is in.
- *Targets in studies:* `targets` keyed at moments move an instance along a straight line between them (directions mixed and renormalised), each frame solved from the one before. Keyed joints keep their keys; actuators move.
- *Carrying is a pose rule, not a joint:* a study's `carries` override the carried part's pose after each frame is solved: from `from` it keeps its place on its carrier, and after `until` it stays where it was last carried. Only parts no joint holds can be carried, so no loop or joint has to give way. Collision checks leave a part and its carrier out while it is carried.
- *A study's moment by playing up to it:* `at(study, time)` plays the study with its duration cut to that time (about 50 frames a second), so the last frame is exactly then and loops follow the motion as in playback. Frames now carry every joint's values.
- *Joint loads by virtual work:* each actuator's freedom moves a hundredth of a degree (or mm) either way with the other actuators held and passive joints closing the loops; the load is the masses' work per unit of the freedom against gravity and their accelerations (Σ m (a − g)·∂x/∂q). Actuators are the driven joints, or every joint of an open chain; an assembly with loops and no driven joints is refused, since it would not say which joints carry the load. Masses are each body's at its centre, from the materials.

*Why:* the robot arm's poses and the platform's leg lengths were worked out outside CADence, the pick-and-place cube could not be carried, a study could only be checked by eye, and choosing motors needed torques ([[Robot arm]], [[Stewart platform]]).
*Trade-off:* reaching finds the nearest solution from where the joints are, not every solution; a far target can end in a local minimum. Targets move along straight lines in space, not along the joints' own paths. Loads leave out the parts' spin (their inertia about their centres), friction and pattern copies; accelerations come from the frames' second differences, so a study with too few frames per second underestimates them.
