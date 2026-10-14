# Open points

Everything phases 0–6 left out, deferred on purpose, or only half covered, collected from the tasks, the decisions and the phase reports. **Check the box of every point you want implemented**, and add your own at the end of a section or under [Your additions](#your-additions). Checked points become tasks in the next phases.

Each point says where it comes from: a task, a decision ([[Architecture/Decisions]]), or a phase report. Points marked *(new)* were never discussed but follow naturally from what exists.

[TOC]

## Obligations and housekeeping

- [ ] **About dialog with licence credits.** ADR-2 promises to credit OpenCascade (LGPL-2.1) and planegcs (LGPL) in an About dialog; no such dialog exists yet. *(ADR-2, ADR-3; an obligation before any release)*
- [ ] **Merge the phase branches into `master`.** Every phase lives on its own branch (`feature/phase-1-foundation` … `feature/phase-6-import`), each built on the previous one; nothing is merged or pushed yet. *(git process)*
- [ ] **Continuous integration.** `npm run verify` and the Playwright journeys run only locally; there is no CI pipeline. *(new)*
- [ ] **Desktop smoke tests in the repository.** The desktop checks (WebView2 remote debugging, window capture) are scripts outside the repository and run by hand. *(phases 1–6)*
- [ ] **Desktop installers.** Only the bare executable was built and tested (`tauri build --no-bundle`); the MSI/NSIS installers, code signing and auto-update are untried. *(phase 1)*
- [ ] **Native save dialog under test.** Exports on desktop go through the Tauri save dialog, which no automated test drives. *(phase 3)*
- [ ] **End-to-end coverage of all features.** Revolve, shell, chamfer, construction planes, circular pattern and mirror are tested in the engine but not clicked through in a browser test. *(phase 3)*
- [ ] **Other browsers.** Browser tests run in Chromium only; Firefox and Safari (WebGL 2 fallback, file APIs) are untested. *(new)*

## Projects and documents

- [ ] **Thumbnails** of projects and documents on the home page and in the documents panel. *(Architecture: Home client)*
- [ ] **Drag and drop to import** files onto the documents panel or the home page. *(Architecture: Imported files are "picked or dropped"; only the picker exists)*
- [ ] **Open with CADence** from the operating system (file associations on desktop). *(Volatility analysis, host file exchange)*
- [ ] **Duplicate** projects and documents. *(Volatility analysis, project workflow)*
- [ ] **Replace an imported file with a newer version**, keeping the features and instances that use it. *(new)*
- [ ] **Export or back up a whole project** (one archive with documents and originals), and import it again. *(new)*
- [ ] **Version history** of documents beyond undo (named versions, restore). *(Volatility analysis: "later versioned or shared")*
- [ ] **Cloud or git sync** of project folders. *(Volatility analysis, storage medium)*
- [ ] **Users, sign-in and sharing.** *(Volatility analysis: deliberately not encapsulated)*
- [ ] **Real-time collaboration.** Commands keep it possible. *(Volatility analysis: not planned)*
- [ ] **Large originals in OPFS** instead of IndexedDB, if imports get big. *(ADR-5)*

## Sketching

- [ ] **Project body edges into a sketch** as reference geometry that follows the body. *([[CAD-29]])*
- [ ] **Pattern and mirror sketch geometry.** *([[CAD-29]])*
- [ ] **More drawing tools:** slot, polygon, center rectangle, three-point arc, ellipse, spline, text. *(new; the sketcher has line, rectangle, circle, arc, point)*
- [ ] **Editing tools:** trim, extend, split, offset, sketch fillet and chamfer. *(new)*
- [ ] **More relations:** symmetric, concentric, collinear, horizontal/vertical alignment of two points. *(new)*
- [ ] **Box selection, copy and paste, move and rotate** of sketch geometry. *(new)*
- [ ] **Constraints for imported drawings** (fix them, or infer horizontal, vertical, tangent). Imported curves arrive unconstrained. *(phase 6, ADR-22)*

## Part modeling

- [ ] **Reorder the timeline and roll back** to insert features earlier. *([[CAD-28]])*
- [ ] **More construction planes:** at an angle, midplanes, through three points. *([[CAD-30]])*
- [ ] **Export options:** choose bodies, mesh quality for STL, 3MF and OBJ. *([[CAD-30]])*
- [ ] **Loft and sweep.** OpenCascade supports both. *(ADR-2 lists them; not built)*
- [ ] **Hole feature** with counterbore, countersink and print-friendly options. *(new)*
- [ ] **Threads**, cosmetic or modelled (screw holes for prints). *(new)*
- [ ] **Draft, rib, variable fillet.** *(new)*
- [ ] **Body operations:** combine bodies (join/cut/intersect existing bodies), split a body, move or copy a body, scale. *(new)*
- [ ] **Text on faces**, embossed or engraved. *(new)*
- [ ] **Pattern along a path.** *(new)*
- [ ] **Sheet metal** (flanges and unfolding). *(new)*
- [ ] **Configurations:** variants of one component with other parameter values, also per assembly instance. *(ADR-11 trade-off)*
- [ ] **Project-wide parameters** shared by several components. *(new)*
- [ ] **Display units:** the document stores a unit (mm, cm, in), but the editor always shows millimetres. *(Document model)*
- [ ] **More stable names for freeform faces** (B-spline faces only match by centre and area). *(ADR-15 trade-off)*

## Viewport and interaction

- [ ] **Zoom to fit** in component and assembly mode (only the imported viewer frames its contents). *(phase 6)*
- [ ] **Pick vertices**, not only faces and edges (for measuring and references). *(Architecture: Viewport client)*
- [ ] **Show and hide bodies and instances, transparency, colours per body.** *(new)*
- [ ] **Section view** (a cutting plane through the model). *(new)*
- [ ] **Orthographic camera** as an option to perspective. *(new)*
- [ ] **Keyboard shortcut reference** and more shortcuts. *(new)*
- [ ] **Light and dark theme switch** in the app (today it follows the system). *(new)*
- [ ] **Touch and tablet use.** *(new)*

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
- [ ] **Fit arcs to Béziers and splines** instead of short lines. *([[CAD-27]], ADR-22)*
- [ ] **DXF blocks (INSERT), text and hatches.** *([[CAD-27]])*
- [ ] **SVG text** (as outlines). *(new)*
- [ ] **More formats:** IGES, BREP, AMF, colours from 3MF and OBJ. *(new)*

## Platform and performance

- [ ] **Offline use and caching** of the 23 MB kernel through a service worker (installable web app). *(ADR-2 mentions the service worker; not built)*
- [ ] **Performance on large models and assemblies:** measure and optimise (meshing in the worker, level of detail). *(new)*
- [ ] **Rust/WASM where profiling shows a need.** So far it never did (ADR-18). *(ADR-8)*
- [ ] **Scripting API or command line** for automation. *(Volatility analysis, client and host)*
- [ ] **Accessibility review** (keyboard use of the 3D view, screen reader labels). *(new)*
- [ ] **Translations** of the interface. *(new)*
- [ ] **macOS and Linux desktop builds.** Only Windows was built and tested. *(new)*

## Your additions

Add points that fit no section above here, as `- [ ] **Name.** What it should do.`
