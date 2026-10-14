# Decisions

Architecture decision records. Each one records what was decided, why, and what we gave up. Add new ones at the end, and mark an ADR as *superseded* instead of deleting it.

[TOC]

## ADR-1

**iDesign with test-enforced layers.** The system is decomposed by volatility into Clients, Managers, Engines, Resource Access, Resources and Utilities ([[Architecture]]). The call rules are enforced by an architecture test over the real import graph ([[tools/architecture/rules.ts]]), so violations fail `npm test` rather than a review. This replaced the first plan of using `eslint-plugin-boundaries`, whose v7 configuration API changed completely; a ~100-line checker with its own tests is easier to trust.
*Trade-off:* more interfaces and a composition root up front. In return, features (new feature types, formats, hosts) land in one component.

## ADR-2

**OCCT as the B-rep kernel, via `replicad-opencascadejs`.** It is the only mature open-source B-rep kernel that runs in WASM, with booleans, fillets, chamfers, shell, sweeps, lofts and native STEP read/write. `replicad-opencascadejs` is a maintained, trimmed OCCT build (LGPL-2.1, last released 2026-09). The `replicad` library (MIT) may be used *inside* engines as a convenience layer and is never exposed beyond them. The kernel runs in a Web Worker.
*Trade-off:* a large download (tens of MB, cached by the service worker / bundled on desktop) and LGPL obligations: we ship the WASM unmodified and dynamically loaded, and we credit it in the About dialog. Rejected: Truck (Rust; immature fillets, partial STEP), Manifold (mesh only; no true STEP or fillets).

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
*Trade-off:* results are caches that can go stale, so they are keyed by content hash and validated on use. Per-instance parameter overrides (configurations) will need a variant key on the request when they arrive.

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

**One geometry worker, engines behind typed RPC, results validated.** The Modeling and Interchange engines run in a dedicated Web Worker with their own Shape Access (an LRU cache of OCCT solids that frees WebAssembly memory). The main thread calls them through `remote<T>()` proxies ([[src/core/utilities/messaging/rpc.ts]]); meshes travel as transferable typed arrays. Every feature result is checked with OCCT's `BRepCheck_Analyzer`, and a shell that leaves the solid unchanged is reported as an error.
*Why:* the UI never blocks on the kernel, and kernel failures become messages instead of broken bodies.
*Trade-off:* every regeneration costs a few round trips, so outcomes are cached in the worker by content hash and meshes on the main thread by body key.

## ADR-17

**Regeneration on every command; refusals guard the target.** Each command regenerates the whole timeline, which is cheap thanks to the caches. A command is refused when its own target fails (a feature that cannot be built, a sketch that conflicts). A parameter change is refused when it breaks anything that worked before. Upstream edits that break a later feature are accepted, and the timeline marks that feature as failed with the reason, as in other parametric CAD tools.
