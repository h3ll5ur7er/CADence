# Open points

What CADence does not do yet: points left open by phases 0–14 (deferred on purpose, trade-offs of decisions, gaps from the phase reports) and ideas for what such an application could do next. Points that were implemented are gone from this page; they live on as tasks ([[Roadmap]]).

**Check the box of every point you want implemented**, and add your own at the end of a section or under [Your additions](#your-additions). Checked points become tasks in the next phases; the arrow after a checked point names its task, and ✅ marks the points that are done.

Each point says where it comes from: a task, a decision ([[Architecture/Decisions]]), or a phase report. Points marked *(new)* were never discussed.

[TOC]

## Obligations and housekeeping

- [X] **About dialog with licence credits.** ADR-2 promises to credit OpenCascade (LGPL-2.1) and planegcs (LGPL) in an About dialog; no such dialog exists yet. The bundled Inter font (SIL Open Font License), opentype.js (MIT) and isomorphic-git (MIT) belong there too. *(ADR-2, ADR-3, ADR-26, ADR-30; an obligation before any release)* → [[CAD-57]] ✅
- [X] **Desktop smoke tests in the repository.** The desktop checks (WebView2 remote debugging, window capture) are scripts outside the repository and run by hand. *(phases 1–6)* → [[CAD-58]] ✅
- [X] **Desktop installers.** Only the bare executable was built and tested (`tauri build --no-bundle`); the MSI/NSIS installers, code signing and auto-update are untried. *(phase 1)* → [[CAD-59]] ✅ (code signing documented, needs a certificate)
- [X] **Native save dialog under test.** Exports on desktop go through the Tauri save dialog, which no automated test drives. *(phase 3)* → [[CAD-58]] ✅
- [ ] **Other browsers.** Browser tests run in Chromium only; Firefox and Safari (WebGL 2 fallback, file APIs) are untested. *(new)*
- [ ] **Steadier browser journeys.** The git sync journey failed once in a slow run of the whole suite (phase 14); look for timing assumptions before CI shows it again. *(phase 14)*
- [ ] **Release process:** version numbers, a changelog and release notes in the app ("What's new"). *(new)*

## Projects and documents

- [X] **Drag and drop to import** files onto the documents panel or the home page. The Importing guide already promises it; only the picker exists. *(Architecture: Imported files are "picked or dropped")* → [[CAD-60]] ✅
- [X] **Open with CADence** from the operating system (file associations on desktop). *(Volatility analysis, host file exchange)* → [[CAD-62]] ✅
- [X] **Duplicate** projects and documents. *(Volatility analysis, project workflow)* → [[CAD-60]] ✅
- [X] **Replace an imported file with a newer version**, keeping the features and instances that use it. *(new)* → [[CAD-61]] ✅
- [X] **Export or back up a whole project** (one archive with documents and originals), and import it again. *(new)* → [[CAD-62]] ✅
- [X] **Sync version names** (git tags) along with the versions, and show which versions are on the remote. *(ADR-30 trade-off)* → [[CAD-63]] ✅
- [ ] **Remember the sign-in** for a remote in the operating system's keychain on the desktop, or sign in with OAuth (GitHub, GitLab). *(ADR-30 trade-off)*
- [ ] **Own CORS proxy for git sync:** a ready-made, self-hostable proxy (e.g. a Cloudflare Worker template), so sign-ins never pass through a third party. *(ADR-30 trade-off)*
- [ ] **Three-way merge inside a document** (e.g. two people adding different features to one component), instead of choosing one side. *(ADR-30 trade-off)*
- [ ] **Compare versions** of a component side by side, or overlaid, in the viewport. *(new)*
- [ ] **Users, sign-in and sharing.** *(Volatility analysis: deliberately not encapsulated)*
- [ ] **Real-time collaboration.** Commands keep it possible. *(Volatility analysis: not planned)*
- [ ] **Large originals in OPFS** instead of IndexedDB, if imports get big. *(ADR-5)*
- [X] **Templates and starter projects:** new projects from a template (box with lid, wall bracket, enclosure), each with its parameters ready to change. *(new)* → [[CAD-64]] ✅
- [ ] **Search** across projects and documents, and sorting, folders or tags on the home page. *(new)*
- [ ] **Trash:** deleted projects and documents can be restored for a while. *(new)*
- [ ] **Project notes and attachments:** a description, photos, datasheets and links kept with the project. *(new)*
- [X] **Share a model as one file:** a self-contained HTML viewer (rotate, measure, explode) to send to people without CADence. *(new)* → [[CAD-65]] ✅

## Sketching

- [X] **Trace a picture:** an image as the sketch background, scaled by a known length, to draw over a photo or a scan. *(new)* → [[CAD-66]] ✅
- [X] **Explain over-constrained sketches:** show which relations and dimensions conflict, and offer to remove one. *(new)* → [[CAD-68]] ✅
- [X] **Suggest relations and dimensions** that would fully define a sketch. *(new)* → [[CAD-68]] ✅
- [X] **Curves from equations** (x(t), y(t)), e.g. involutes and cams. *(new)* → [[CAD-69]] ✅
- [X] **More fonts** for text: other Google Fonts or the system's fonts. *(new)* → [[CAD-70]] ✅
- [X] **Text along a curve.** *(new)* → [[CAD-70]] ✅
- [X] **Highlight** under-defined / open DOF parts in sketches *(your addition)* → [[CAD-68]] ✅

## Part modeling

- [ ] **Sheet metal II:** flanges on flanges in the flat pattern, corner reliefs, hems and miter flanges. *(ADR-29 trade-off)*
- [ ] **NURBS**
- [ ] **Scale bodies per axis.** Needs `BRepBuilderAPI_GTransform`, missing from the bundled OpenCascade build; a custom `replicad-opencascadejs` build could add it (and `gp_Cone`, `gp_Torus`). *(ADR-28)*
- [ ] **Rib up to the next face** instead of a set depth, and **drill points** at the bottom of blind holes. *(ADR-28 trade-offs)*
- [X] **Standard parts library:** screws, nuts, washers, bearings, heat-set inserts and magnets by size (ISO/DIN), inserted into components or assemblies, with matching holes. *(new)* → [[CAD-71]]
- [X] **Gear generator:** spur, helical and rack gears from module and number of teeth, with matching pairs. *(new)* → [[CAD-72]]
- [X] **Print-friendly generators:** snap fits, living hinges, dovetails and press-fit pegs. *(new)* → [[CAD-73]]
- [X] **Clearances for prints:** fit classes (press, snug, loose) and a printer-specific offset applied to holes and pegs. *(new)* → [[CAD-74]]
- [ ] **Lithophanes and image embossing:** a picture turned into relief on a face. *(new)*
- [ ] **Textures:** knurling and patterned surfaces on faces. *(new)*
- [ ] **Direct editing of imported solids:** push and pull faces, delete holes and fillets of a STEP part without its history. *(new)*
- [ ] **Surface modeling:** boundary surfaces, thicken, patch and knit into solids. *(new)*
- [X] **Timeline folders and notes:** group features, comment why they are there. *(new)* → [[CAD-75]]
- [X] **Repair broken references** in a dialog: show what a feature lost (a face or an edge) and let the user pick the replacement. *(new)* → [[CAD-76]]
- [X] **Configurations as a table:** import and export them as CSV. *(new)* → [[CAD-77]]

## Technical drawings

- [X] **Drawings of parts and assemblies:** a new document kind with standard views (front, top, side, isometric), section and detail views, dimensions and notes, a title block, and export as PDF and DXF. Views update when the model changes. *(new)* → [[CAD-87]] [[CAD-88]]
- [X] **Hole and thread callouts, and a parts list** on drawings, from the model. *(new)* → [[CAD-89]]

## Viewport and interaction

- [ ] **Light and dark theme switch** in the app (today it follows the system). *(new)*
- [ ] **Touch and tablet use.** *(new)*
- [X] **Command palette** (Ctrl+K): find and run any tool or command by name. *(new)* → [[CAD-78]]
- [ ] **Named views:** save camera positions and section planes, and return to them. *(new)*
- [X] **Better looks and pictures:** materials with environment lighting, and image and turntable video export with a transparent background. *(new)* → [[CAD-90]]
- [X] **Surface analysis:** zebra stripes, curvature and draft angle shown on the faces. *(new)* → [[CAD-91]]
- [ ] **Augmented reality:** look at a part at real size on a phone (WebXR, or a USDZ/glTF export). *(new)*
- [ ] **Undo history panel:** see the commands that were applied and step back to any of them. *(new)*
- [ ] **Onboarding:** a short interactive tour and sample projects, with links from tools to the User guide. *(new)*

## Analysis and manufacturing

- [ ] **Resin (SLA) printer profiles** with their own rules (no nozzle; drain holes, suction cups). *([[CAD-21]])*
- [ ] **Machine profiles per user,** shared by all components (today each component stores its own). *(ADR-19 trade-off)*
- [ ] **A finer wall check** that cannot miss a thin spot inside one large flat triangle. *(ADR-18 trade-off)*
- [X] **Measure in assemblies,** between instances. *(phase 5)* → [[CAD-80]]
- [ ] **Mass properties of assemblies:** total mass and centre of mass. *(new)*
- [ ] **Material per body** rather than per component. *(phase 4)*
- [ ] **Print orientation:** suggest the orientation with the least support. *(new)*
- [ ] **Print estimates:** filament use and print time. *(new)*
- [ ] **Arrange parts on the build plate** and export them as one 3MF. *(new)*
- [ ] **Send to the printer:** open the 3MF in a slicer (PrusaSlicer, OrcaSlicer, Bambu Studio) on the desktop, or upload it to OctoPrint or Klipper (Moonraker). *(new)*
- [ ] **Cost estimates:** material price per kilogram or per sheet, machine time. *(new)*
- [ ] **Laser: export a flat face of a body as DXF/SVG,** so parts designed in 3D can be cut. *(new)*
- [ ] **Laser: nest parts on the sheet** to save material. *(Volatility analysis mentions nesting)*
- [ ] **Laser: cut and engrave layers** by colour in the exported files. *(new)*
- [ ] **Laser: finger joints and box generator** for flat-pack designs. *(new)*
- [ ] **Laser: test patterns** for kerf and power/speed, and raster engraving of pictures. *(new)*
- [ ] **CNC milling (2.5D CAM):** pockets, profiles and drilling as toolpaths, exported as G-code. *(new)*
- [X] **Simple strength check (FEA):** a linear static analysis of a part with fixed faces and loads, showing stress and deflection. *(new)* → [[CAD-93]]

## Assemblies

- [X] **Drag parts in the 3D view:** free instances anywhere, jointed ones along their free directions. Today they move with fields and sliders. *([[CAD-22]], [[CAD-23]])* → [[CAD-79]]
- [X] **Joint offsets:** place a joint origin away from the picked face or edge. *(ADR-21 trade-off)* → [[CAD-79]]
- [ ] **Sub-assemblies** and a STEP product tree that keeps them. *([[CAD-25]])*
- [X] **Motion links:** gears, rack and pinion, belts (one joint drives another by a ratio). *(new)* → [[CAD-83]]
- [X] **Collision detection during motion** (stop or flag where parts hit). *(new)* → [[CAD-84]]
- [ ] **Dynamics:** gravity, forces, contact. Motion is kinematic only. *(ADR-20 trade-off)*
- [X] **Smoother motion studies:** easing between keys, speeds (rpm, mm/s) instead of key values. *(new)* → [[CAD-84]]
- [X] **Exploded views.** *(new)* → [[CAD-85]]
- [X] **Bill of materials:** parts, counts, materials, masses; exported as CSV. *(new)* → [[CAD-86]]
- [X] **Assembly instructions:** step-by-step exploded steps, exported as a PDF, for flat-pack and kit builds. *(new)* → [[CAD-85]]
- [X] **Patterns and mirrors of instances.** *(new)* → [[CAD-81]]
- [X] **Live updates:** an open assembly updates when a component changes in another tab or window (today on reopening). *(phase 5)* → [[CAD-82]]

## Import

- [ ] **Solids from meshes above 100,000 triangles**, with decimation (simplifying) first. *([[CAD-26]], ADR-22)*
- [ ] **Repair open or broken meshes** before making them solid. *(new)*
- [ ] **More formats:** IGES, BREP, AMF, glTF, colours from 3MF and OBJ. *(new)*
- [X] **Pictures to outlines:** trace a bitmap (logo, drawing) into sketch curves. *(new)* → [[CAD-67]] ✅
- [ ] **Circuit boards:** import a KiCad board (outline, holes, component heights) to design an enclosure around it. *(new)*

## Automation and AI

- [ ] **Publish the command line as a package** (`npx cadence`), so it runs without a copy of the repository. *(ADR-31 trade-off)*
- [X] **Pictures for agents:** an MCP tool that renders a component to PNG, so an agent can look at what it made. *(ADR-31 trade-off)* → [[CAD-92]]
- [ ] **MCP over HTTP** from the running app, so an agent can drive the web app's projects directly. *(ADR-31 trade-off)*
- [ ] **An assistant in the app:** describe a part or a change in words, and an AI model builds it with the same tools the MCP server offers, step by step in the timeline. *(new)*
- [ ] **Script console in the app:** run scripts against the open project, and keep them with the project as reusable generators. *(new)*

## Platform and performance

- [X] **Performance on large models and assemblies:** measure and optimise (meshing in the worker, level of detail). *(new)* → [[CAD-94]]
- [X] **Rust/WASM where profiling shows a need.** So far it never did (ADR-18). *(ADR-8)* → [[CAD-95]]
- [ ] **Performance budgets in CI:** fail when start-up, regeneration or bundle size get noticeably worse. *(new)*
- [ ] **Accessibility review** (keyboard use of the 3D view, screen reader labels). *(new)*
- [ ] **Translations** of the interface. *(new)*
- [ ] **macOS and Linux desktop builds.** Only Windows was built and tested. *(new)*
- [ ] **A phone-friendly viewer:** open, view, measure and share models on a phone. *(new)*

## Your additions

- 
