# Open points

Everything phases 0–6 left out, deferred on purpose, or only half covered, collected from the tasks, the decisions and the phase reports. **Check the box of every point you want implemented**, and add your own at the end of a section or under [Your additions](#your-additions). Checked points become tasks in the next phases; the arrow after a checked point names its task ([[Roadmap]]), and ✅ marks the points that are done.

Each point says where it comes from: a task, a decision ([[Architecture/Decisions]]), or a phase report. Points marked *(new)* were never discussed but follow naturally from what exists.

[TOC]

## Obligations and housekeeping

- [ ] **About dialog with licence credits.** ADR-2 promises to credit OpenCascade (LGPL-2.1) and planegcs (LGPL) in an About dialog; no such dialog exists yet. The bundled Inter font (SIL Open Font License) and opentype.js (MIT) belong there too (ADR-26). *(ADR-2, ADR-3; an obligation before any release)*
- [X] **Merge the phase branches into `master`.** Every phase lives on its own branch (`feature/phase-1-foundation` … `feature/phase-6-import`), each built on the previous one; nothing is merged or pushed yet. *(git process)* → [[CAD-31]] ✅
- [X] **Continuous integration.** `npm run verify` and the Playwright journeys run only locally; there is no CI pipeline. *(new)* → [[CAD-31]] ✅
- [X] **deployment using github pages** → [[CAD-32]] ✅
- [ ] **Desktop smoke tests in the repository.** The desktop checks (WebView2 remote debugging, window capture) are scripts outside the repository and run by hand. *(phases 1–6)*
- [ ] **Desktop installers.** Only the bare executable was built and tested (`tauri build --no-bundle`); the MSI/NSIS installers, code signing and auto-update are untried. *(phase 1)*
- [ ] **Native save dialog under test.** Exports on desktop go through the Tauri save dialog, which no automated test drives. *(phase 3)*
- [X] **End-to-end coverage of all features.** Revolve, shell, chamfer, construction planes, circular pattern and mirror are tested in the engine but not clicked through in a browser test. *(phase 3)* → [[CAD-33]] ✅
- [ ] **Other browsers.** Browser tests run in Chromium only; Firefox and Safari (WebGL 2 fallback, file APIs) are untested. *(new)*

## Projects and documents

- [X] **Thumbnails** of projects and documents on the home page and in the documents panel. *(Architecture: Home client)* → [[CAD-52]] ✅
- [ ] **Drag and drop to import** files onto the documents panel or the home page. *(Architecture: Imported files are "picked or dropped"; only the picker exists)*
- [ ] **Open with CADence** from the operating system (file associations on desktop). *(Volatility analysis, host file exchange)*
- [ ] **Duplicate** projects and documents. *(Volatility analysis, project workflow)*
- [ ] **Replace an imported file with a newer version**, keeping the features and instances that use it. *(new)*
- [ ] **Export or back up a whole project** (one archive with documents and originals), and import it again. *(new)*
- [X] **Version history** of documents beyond undo (named versions, restore, git based with user settable version tags). *(Volatility analysis: "later versioned or shared")* → [[CAD-53]] ✅
- [X] **Cloud or git sync** of project folders. *(Volatility analysis, storage medium)* → [[CAD-54]] ✅
- [ ] **Sync version names** (git tags) along with the versions, and show which versions are on the remote. *(ADR-30 trade-off)*
- [ ] **Remember the sign-in** for a remote in the operating system's keychain on the desktop, or sign in with OAuth (GitHub, GitLab). *(ADR-30 trade-off)*
- [ ] **Three-way merge inside a document** (e.g. two people adding different features to one component), instead of choosing one side. *(ADR-30 trade-off)*
- [ ] **Compare versions** of a component side by side in the viewport. *(new)*
- [ ] **Users, sign-in and sharing.** *(Volatility analysis: deliberately not encapsulated)*
- [ ] **Real-time collaboration.** Commands keep it possible. *(Volatility analysis: not planned)*
- [ ] **Large originals in OPFS** instead of IndexedDB, if imports get big. *(ADR-5)*

## Sketching

- [X] **Project body edges into a sketch** as reference geometry that follows the body. *([[CAD-29]])* → [[CAD-29]] ✅
- [X] **Pattern and mirror sketch geometry.** *([[CAD-29]])* → [[CAD-29]] ✅
- [X] **More drawing tools:** slot, polygon, center rectangle, three-point arc, ellipse, spline, text. *(new; the sketcher has line, rectangle, circle, arc, point)* → [[CAD-37]] [[CAD-41]] ✅
- [X] **Editing tools:** trim, extend, split, offset, sketch fillet and chamfer. *(new)* → [[CAD-38]] ✅
- [X] **More relations:** symmetric, concentric, collinear, horizontal/vertical alignment of two points. *(new)* → [[CAD-39]] ✅
- [X] **Box selection, copy and paste, move and rotate** of sketch geometry. *(new)* → [[CAD-40]] ✅
- [X] **Constraints for imported drawings** (fix them, or infer horizontal, vertical, tangent). Imported curves arrive unconstrained. *(phase 6, ADR-22)* → [[CAD-42]] ✅
- [X] **Snap to existing geometry** e.g. if a point is placed on a line, a coincidence relation shall be created automatically. → [[CAD-39]] ✅

## Part modeling

- [X] **Reorder the timeline and roll back** to insert features earlier. *([[CAD-28]])* → [[CAD-28]] ✅
- [X] **More construction planes:** at an angle, midplanes, through three points. *([[CAD-30]])* → [[CAD-30]] ✅
- [X] **Export options:** choose bodies, mesh quality for STL, 3MF and OBJ. *([[CAD-30]])* → [[CAD-30]] ✅
- [X] **Loft and sweep.** OpenCascade supports both. *(ADR-2 lists them; not built)* → [[CAD-43]] ✅
- [X] **Hole feature** with counterbore, countersink and print-friendly options. *(new)* → [[CAD-44]] ✅
- [X] **Threads**, cosmetic or modelled (screw holes for prints). *(new)* → [[CAD-44]] ✅
- [X] **Draft, rib, variable fillet.** *(new)* → [[CAD-45]] ✅
- [X] **Body operations:** combine bodies (join/cut/intersect existing bodies), split a body, move or copy a body, scale. *(new)* → [[CAD-46]] ✅ (uniform scale only)
- [X] **Text on faces**, embossed or engraved. *(new)* → [[CAD-41]] ✅
- [X] **Pattern along a path.** *(new)* → [[CAD-43]] ✅
- [X] **Sheet metal** (flanges and unfolding). *(new)* → [[CAD-51]] ✅
- [ ] **Sheet metal II:** flanges on flanges in the flat pattern, corner reliefs, hems and miter flanges. *(ADR-29 trade-off)*
- [X] **Configurations:** variants of one component with other parameter values, also per assembly instance. *(ADR-11 trade-off)* → [[CAD-50]] ✅
- [X] **Project-wide parameters** shared by several components. *(new)* → [[CAD-49]] ✅
- [X] **Display units:** the document stores a unit (mm, cm, in), but the editor always shows millimetres. *(Document model)* → [[CAD-48]] ✅
- [X] **More stable names for freeform faces** (B-spline faces only match by centre and area). *(ADR-15 trade-off)* → [[CAD-47]] ✅
- [ ] **NURBS**
- [ ] **Scale bodies per axis.** Needs `BRepBuilderAPI_GTransform`, missing from the bundled OpenCascade build; a custom `replicad-opencascadejs` build could add it (and `gp_Cone`, `gp_Torus`). *(ADR-28)*
- [ ] **Rib up to the next face** instead of a set depth, and **drill points** at the bottom of blind holes. *(ADR-28 trade-offs)*

## Viewport and interaction

- [X] **Zoom to fit** in component and assembly mode (only the imported viewer frames its contents). *(phase 6)* → [[CAD-34]] ✅
- [X] **Pick vertices**, not only faces and edges (for measuring and references). *(Architecture: Viewport client)* → [[CAD-35]] ✅
- [X] **Show and hide bodies and instances, transparency, colours per body.** *(new)* → [[CAD-35]] ✅
- [X] **Section view** (a cutting plane through the model). *(new)* → [[CAD-34]] ✅
- [X] **Orthographic camera** as an option to perspective. *(new)* → [[CAD-34]] ✅
- [X] **Keyboard shortcut reference** and more shortcuts. *(new)* → [[CAD-36]] ✅
- [ ] **Light and dark theme switch** in the app (today it follows the system). *(new)*
- [ ] **Touch and tablet use.** *(new)*
- [X] **Change control schema** CADence (default), Fusion360, Onshape → [[CAD-36]] ✅

## Analysis and manufacturing

- [ ] **Resin (SLA) printer profiles** with their own rules (no nozzle; drain holes, suction cups). *([[CAD-21]])*
- [ ] **Machine profiles per user,** shared by all components (today each component stores its own). *(ADR-19 trade-off)*
- [ ] **A finer wall check** that cannot miss a thin spot inside one large flat triangle. *(ADR-18 trade-off)*
- [ ] **Measure in assemblies,** between instances. *(phase 5)*
- [ ] **Mass properties of assemblies:** total mass and centre of mass. *(new)*
- [ ] **Material per body** rather than per component. *(phase 4)*
- [ ] **Print orientation:** suggest the orientation with the least support. *(new)*
- [ ] **Print estimates:** filament use and print time. *(new)*
- [ ] **Arrange parts on the build plate** and export them as one 3MF. *(new)*
- [ ] **Laser: export a flat face of a body as DXF/SVG,** so parts designed in 3D can be cut. *(new)*
- [ ] **Laser: nest parts on the sheet** to save material. *(Volatility analysis mentions nesting)*
- [ ] **Laser: cut and engrave layers** by colour in the exported files. *(new)*
- [ ] **Laser: finger joints and box generator** for flat-pack designs. *(new)*

## Assemblies

- [ ] **Drag parts in the 3D view:** free instances anywhere, jointed ones along their free directions. Today they move with fields and sliders. *([[CAD-22]], [[CAD-23]])*
- [ ] **Joint offsets:** place a joint origin away from the picked face or edge. *(ADR-21 trade-off)*
- [ ] **Sub-assemblies** and a STEP product tree that keeps them. *([[CAD-25]])*
- [ ] **Motion links:** gears, rack and pinion, belts (one joint drives another by a ratio). *(new)*
- [ ] **Collision detection during motion** (stop or flag where parts hit). *(new)*
- [ ] **Dynamics:** gravity, forces, contact. Motion is kinematic only. *(ADR-20 trade-off)*
- [ ] **Smoother motion studies:** easing between keys, speeds (rpm, mm/s) instead of key values. *(new)*
- [ ] **Exploded views.** *(new)*
- [ ] **Bill of materials:** parts, counts, materials, masses. *(new)*
- [ ] **Live updates:** an open assembly updates when a component changes in another tab or window (today on reopening). *(phase 5)*

## Import

- [ ] **Solids from meshes above 100,000 triangles**, with decimation (simplifying) first. *([[CAD-26]], ADR-22)*
- [ ] **Repair open or broken meshes** before making them solid. *(new)*
- [X] **Fit arcs to Béziers and splines** instead of short lines. *([[CAD-27]], ADR-22)* → [[CAD-42]] ✅
- [X] **DXF blocks (INSERT), text and hatches.** *([[CAD-27]])* → [[CAD-41]] [[CAD-42]] ✅
- [X] **SVG text** (as editable text, outlines on conversion). *(new)* → [[CAD-41]] ✅
- [X] **Option to keep ratios** When importing svg/dxf, there should be an option for them to keep their ratios. Moving/scaling should do so with the entire image, not individual lines. → [[CAD-42]] ✅
- [ ] **More formats:** IGES, BREP, AMF, colours from 3MF and OBJ. *(new)*

## Platform and performance

- [X] **Offline use and caching** of the 23 MB kernel through a service worker (installable web app). *(ADR-2 mentions the service worker; not built)* → [[CAD-32]] ✅
- [ ] **Performance on large models and assemblies:** measure and optimise (meshing in the worker, level of detail). *(new)*
- [ ] **Rust/WASM where profiling shows a need.** So far it never did (ADR-18). *(ADR-8)*
- [X] **Scripting API or command line** for automation. *(Volatility analysis, client and host)* → [[CAD-55]] ✅
- [X] **MCP server** Allow remote control by agentic AI → [[CAD-56]] ✅
- [ ] **Publish the command line as a package** (`npx cadence`), so it runs without a copy of the repository. *(ADR-31 trade-off)*
- [ ] **Pictures for agents:** an MCP tool that renders a component to PNG, so an agent can look at what it made. *(ADR-31 trade-off)*
- [ ] **MCP over HTTP** from the running app, so an agent can drive the web app's projects directly. *(ADR-31 trade-off)*
- [ ] **Accessibility review** (keyboard use of the 3D view, screen reader labels). *(new)*
- [ ] **Translations** of the interface. *(new)*
- [ ] **macOS and Linux desktop builds.** Only Windows was built and tested. *(new)*

## Your additions

- Additions so far were placed in their sections: deployment on GitHub Pages, NURBS, snapping with automatic relations, control schemes, keeping the ratios of imported drawings, an MCP server.
