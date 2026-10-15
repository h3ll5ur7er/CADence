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

## ADR-23

**Delivery: one CI workflow, GitHub Pages for the web app, Angular's service worker for offline use.** `.github/workflows/ci.yml` checks every push and pull request (`npm run verify`; the Playwright journeys against the dev server and against the Pages build) and, on `master` only and after both passed, publishes the Pages build. The web app is built for its sub-path (`npm run build:pages`, base `/<repository>/`); static hosts answer unknown paths with `404.html`, which is a copy of `index.html`, so deep links open the app. The kernel and solver URLs were already relative to the document and the worker, so nothing else changed.
Offline use comes from `@angular/service-worker` ([[ngsw-config.json]]): the app shell is cached on install, the WebAssembly kernels (OpenCascade 23 MB, planegcs 1 MB) on first use. Once a part has been modelled online, the app works without a network. A new version downloads in the background and a notice offers to reload. The desktop app registers no service worker: it is installed and bundles everything.
*Why:* Pages is free, needs no server, and serves from the repository the code lives in; the Angular service worker is maintained with the framework and versions the cache by content hashes, so an update never mixes old and new files.
*Trade-off:* the kernels are not prefetched, so a browser that never modelled online has no kernel offline; prefetching would cost every first visit 24 MB. CI runs without a GPU, so the journeys there use software WebGL (SwiftShader), never WebGPU.
