# Open points

What CADence does not do yet: points left open by phases 0–32 (deferred on purpose, trade-offs of decisions, gaps from the phase reports and the stress tests) and ideas for what such an application could do next. Only open points are listed: a point that is implemented is removed from this page. Its task keeps what was done ([[Roadmap]]), and the git history keeps the page as it was.

**Check the box of every point you want implemented**, and add your own at the end of a section or under [Your additions](#your-additions). Checked points become tasks in the next phases; the arrow after a checked point names its task until the point is done and leaves the page.

Each point says where it comes from: a task, a decision ([[Architecture/Decisions]]), or a phase report. Points marked *(new)* were never discussed.

[TOC]

## Obligations and housekeeping

- [ ] **Code signing and notarization:** Windows SmartScreen and macOS Gatekeeper warn about the installers and the command line until they are signed (a code signing certificate; an Apple Developer ID). *(ADR-51 trade-off)*
- [ ] **Installers for Intel Macs and Linux on ARM,** which need runners of their own. *(ADR-51 trade-off)*
- [ ] **The command line for agents checked on every system in CI:** today only release builds make it on macOS and Linux, so a Node update that breaks single executables shows up only when tagging. *(ADR-50, ADR-51)*
- [ ] **Other browsers.** Browser tests run in Chromium only; Firefox and Safari (WebGL 2 fallback, file APIs) are untested. *(new)*
- [ ] **Steadier browser journeys.** The git sync journey still times out now and then in a full run (phases 14, 30 and 31) and passes on its own; look for its timing assumptions. *(phases 14, 30, 31)*
- [ ] **Release process:** a changelog and release notes in the app ("What's new"); the version tool exists. *(new)*
- [ ] **A replaceable kernel without unpacking:** the command line could also take modified kernels from an environment variable, besides its unpacked folder (LGPL). *(ADR-50 trade-off)*

## Projects and documents

- [ ] **Remember the sign-in** for a remote in the operating system's keychain on the desktop, or sign in with OAuth (GitHub, GitLab). *(ADR-30 trade-off)*
- [ ] **Own CORS proxy for git sync:** a ready-made, self-hostable proxy (e.g. a Cloudflare Worker template), so sign-ins never pass through a third party. *(ADR-30 trade-off)*
- [x] **Three-way merge inside a document** (e.g. two people adding different features to one component), instead of choosing one side. *(ADR-30 trade-off)*
- [x] **Compare versions** of a component side by side, or overlaid, in the viewport. *(new)*
- [x] **Users, sign-in and sharing.** *(Volatility analysis: deliberately not encapsulated)*
- [x] **Real-time collaboration.** Commands keep it possible. *(Volatility analysis: not planned)*
- [ ] **Large originals in OPFS** instead of IndexedDB, if imports get big. *(ADR-5)*
- [ ] **Search** across projects and documents, and sorting, folders or tags on the home page. *(new)*
- [x] **Trash:** deleted projects and documents can be restored for a while. *(new)*
- [x] **Project notes and attachments:** a description, photos, datasheets and links kept with the project. *(new)*
- [x] **The desktop app follows what agents change:** it watches the project folders, so a part an agent edits through the MCP server updates in the open editor (today only other tabs of the app are heard). *(new; the radial engine was modelled beside the app)*
- [x] **Libraries shared between projects:** components (standard parts, a company's brackets) kept once and used in many projects, updated everywhere. *(new)*
- [ ] **Versions recorded for agents:** each MCP session or script run kept as a named version, so its changes can be looked at and undone as one. *(new)*

## Sketching

- [x] **Sketches on curved faces:** wrap or project a sketch onto a cylinder or cone (labels, grips, engraved scales). *(new)*
- [x] **Reference dimensions** that show a measured value without driving the sketch. *(new)*
- [x] **Reusable sketch blocks:** a group of curves and relations kept and inserted again (a slot pattern, a logo). *(new)*

## Part modeling

- [x] **Sheet metal II:** flanges on flanges in the flat pattern, corner reliefs, hems and miter flanges. *(ADR-29 trade-off)*
- [ ] **NURBS**
- [ ] **Scale bodies per axis.** Needs `BRepBuilderAPI_GTransform`, missing from the bundled OpenCascade build; a custom `replicad-opencascadejs` build could add it (and `gp_Cone`, `gp_Torus`, and `HLRBRep_PolyAlgo` for drawings). *(ADR-28, ADR-49)*
- [x] **Rib up to the next face** instead of a set depth, and **drill points** at the bottom of blind holes. *(ADR-28 trade-offs)*
- [x] **Standard parts as assembly instances** from a shared library. *(ADR-35 trade-off)*
- [x] **Nested timeline folders**, and repair candidates matched by shape as well as distance. *(ADR-36 trade-offs)*
- [ ] **Lithophanes and image embossing:** a picture turned into relief on a face. *(new)*
- [ ] **Textures:** knurling and patterned surfaces on faces. *(new)*
- [ ] **Direct editing of imported solids:** push and pull faces, delete holes and fillets of a STEP part without its history. *(new)*
- [ ] **Surface modeling:** boundary surfaces, thicken, patch and knit into solids. *(new)*
- [ ] **A start point per loft section**, picked in its sketch, where lining the sections up automatically is not what is meant. *(ADR-43 trade-off)*
- [x] **Root fillets on ring gears**, and profile shifted gears for few teeth. *([[CAD-98]], [[CAD-107]])*
- [x] **Helices and springs:** coils, compression and torsion springs from wire size, pitch and turns. *(new)*
- [x] **Bevel and worm gears** next to spur, helical and ring gears. *(new)*

## Technical drawings

- [x] **Drawings II:** offset and half sections, true-length dimensions on isometric views, tolerances and surface finish symbols. *(ADR-39 trade-offs)*
- [x] **Cosmetic threads:** threads drawn as their major and minor diameters (ISO 6410), not as the modelled helix, which is slow and unusual on a sheet. *([[CAD-125]])*
- [x] **Outlines of cones, spheres and free-form faces** as anchors, as cylinders have them. *([[CAD-127]])*
- [x] **Anchors on the parts of assembly views,** not only their outermost points. *([[CAD-127]])*
- [x] **The exact projection finishing in the background,** replacing a view drawn from the triangles once it is done. *([[CAD-130]])*
- [ ] **Dimensions suggested for a view:** the sizes that define the part (overall, diameters, centre distances), placed without collisions, for people and agents to accept or edit. *(new; dimensioning 28 sheets was most of round 5)*
- [ ] **Hole tables, ordinate and chamfer dimensions.** *(new)*
- [ ] **Several sheets per drawing, sheet templates** (a company's title block) and a revision table. *(new)*

## Viewport and interaction

- [ ] **Light and dark theme switch** in the app (today it follows the system). *(new)*
- [ ] **Touch and tablet use.** *(new)*
- [ ] **Named views:** save camera positions and section planes, and return to them. *(new)*
- [x] **Augmented reality:** look at a part at real size on a phone (WebXR, or a USDZ/glTF export). *(new)*
- [ ] **Undo history panel:** see the commands that were applied and step back to any of them. *(new)*
- [x] **Onboarding:** a short interactive tour and sample projects, with links from tools to the User guide. *(new)*
- [ ] **3D annotations (PMI):** dimensions, notes and tolerances kept on the model in the viewport and in STEP. *(new)*

## Analysis and manufacturing

- [ ] **Resin (SLA) printer profiles** with their own rules (no nozzle; drain holes, suction cups). *([[CAD-21]])*
- [ ] **Machine profiles per user,** shared by all components (today each component stores its own). *(ADR-19 trade-off)*
- [ ] **A finer wall check** that cannot miss a thin spot inside one large flat triangle. *(ADR-18 trade-off)*
- [x] **Material per body** rather than per component. *(phase 4)*
- [ ] **Print orientation:** suggest the orientation with the least support. *(new)*
- [ ] **Print estimates:** filament use and print time. *(new)*
- [ ] **Arrange parts on the build plate** and export them as one 3MF. *(new)*
- [ ] **Send to the printer:** open the 3MF in a slicer (PrusaSlicer, OrcaSlicer, Bambu Studio) on the desktop, or upload it to OctoPrint or Klipper (Moonraker). *(new)*
- [ ] **Multi-colour and multi-material 3MF:** bodies and appearances as filaments for AMS and MMU printers. *(new)*
- [ ] **Cost estimates:** material price per kilogram or per sheet, machine time. *(new)*
- [ ] **Laser: export a flat face of a body as DXF/SVG,** so parts designed in 3D can be cut. *(new)*
- [ ] **Laser: nest parts on the sheet** to save material. *(Volatility analysis mentions nesting)*
- [ ] **Laser: cut and engrave layers** by colour in the exported files. *(new)*
- [ ] **Laser: finger joints and box generator** for flat-pack designs. *(new)*
- [ ] **Laser: test patterns** for kerf and power/speed, and raster engraving of pictures. *(new)*
- [ ] **CNC milling (2.5D CAM):** pockets, profiles and drilling as toolpaths, exported as G-code. *(new)*
- [ ] **Strength check II:** assemblies with contact, natural frequencies, and a mesh that refines where stresses peak. *(ADR-41 trade-offs)*
- [ ] **Tolerance stack-up:** how fits and print tolerances add up along a chain of parts. *(new)*
- [ ] **Lighter parts:** topology optimisation that removes material where the strength check finds little stress. *(new)*

## Assemblies

- [ ] **Sub-assemblies** and a STEP product tree that keeps them. *([[CAD-25]])*
- [ ] **Dynamics:** gravity, forces, contact. Motion is kinematic only. *(ADR-20 trade-off)*
- [ ] **Cam profiles from the cam's face:** the follower riding on the modelled cam instead of a table. *(ADR-45, [[CAD-99]])*
- [ ] **Design in place:** edit a component inside its assembly, sketching on and referring to the parts around it (top-down design). *(new)*
- [ ] **Fasteners for aligned holes:** pick holes through several parts and get matching screws, washers and nuts, in the assembly and its bill of materials. *(new)*
- [ ] **Assembly features:** a hole or cut through several parts at once, made in the assembly. *(new)*

## Import

- [x] **Solids from meshes above 100,000 triangles**, with decimation (simplifying) first. *([[CAD-26]], ADR-22)*
- [ ] **Repair open or broken meshes** before making them solid. *(new)*
- [ ] **More formats:** IGES, BREP, AMF, glTF, colours from 3MF and OBJ. *(new)*
- [x] **Circuit boards:** import a KiCad board (outline, holes, component heights) to design an enclosure around it. *(new)*

## Automation and AI

- [ ] **MCP over HTTP** from the running app, so an agent can drive the web app's projects directly. *(ADR-31 trade-off)*
- [ ] **An assistant in the app:** describe a part or a change in words, and an AI model builds it with the same tools the MCP server offers, step by step in the timeline. *(new)*
- [x] **Script console in the app:** run scripts against the open project, and keep them with the project as reusable generators. *(new)*
- [x] **Scripts for agents through MCP:** a tool that runs a whole generator script, as the radial engine's agent did through the command line to place dimensions on 26 sheets. *(new; [[CAD-128]])*
- [x] **MCP resources and prompts:** the command reference and the user guide as resources, and prompts for common jobs (a part from a sketch, a drawing of a part). *(new)*
- [ ] **The command line as an npm package** (`npx cadence`), for people who have Node, beside the self-contained binary. *(ADR-31, ADR-50)*

## Platform and performance

- [ ] **Performance budgets in CI:** fail when start-up, regeneration or bundle size get noticeably worse. *(new)*
- [ ] **Accessibility review** (keyboard use of the 3D view, screen reader labels). *(new)*
- [ ] **Translations** of the interface. *(new)*
- [x] **A phone-friendly viewer:** open, view, measure and share models on a phone. *(new)*
- [x] **Plugins:** features, generators and exporters others write, loaded by the app and the MCP server. *(new)*

## Future stress tests

The radial engine ([[CAD-96]], [[Magnum opus]]) found 34 issues by building something real through the MCP server, and a keyboard enclosure around an imported circuit board 15 more (phase 33). Each of these would push other parts of CADence as hard. Check the ones to run next; each becomes a task like [[CAD-96]], with its findings filed as tasks.

- [ ] **A mechanical clock:** escapement, gear trains with exact ratios, a pendulum, tiny parts and tight fits. *Stresses:* gears with many teeth and small modules, motion links and studies over long times, fits for printing, drawings of small parts.
- [ ] **A desktop 3D printer:** a frame of aluminium extrusions, linear rails, belts, stepper motors and hundreds of fasteners. *Stresses:* standard parts and sub-assemblies, large assemblies with many identical instances, the bill of materials, build instructions, imported vendor STEP files.
- [x] **A six-axis robot arm:** a chain of revolute joints with limits, a gripper, cable routes. *Stresses:* long kinematic chains, joint limits, motion studies, collision checks over the reach, the strength check of the links.
- [x] **A Stewart platform:** a base and a top plate joined by six legs, each an actuator (a slider) between two ball or universal joints. Simple parts, hard motion: six closed loops share one plate. *Stresses:* many coupled loops solved at once (each leg's length sets the plate's pose), driving the plate's pose and getting the leg lengths (no joint gives that today), joint angle limits and leg collisions over the reach, universal joints (only ball joints exist), motion studies of the plate tilting and turning.
- [ ] **A two-stage planetary gearbox with housing:** bearings, seals and shafts, dimensioned with fits. *Stresses:* planetary links, interference at the teeth, the strength check of shafts and teeth, drawings with tolerances.
- [ ] **A laser-cut flat-pack kit** (a lamp, a shelf or a marble run): finger joints, slots, living hinges. *Stresses:* the laser workflow from 3D to DXF, kerf, nesting, assembly instructions for builders.
- [ ] **A drone or a propeller and a hull:** airfoil lofts, twisted blades, smooth hulls. *Stresses:* lofts and sweeps of spline sections, surface analysis, the kernel on free-form faces (and the drawings of them).
- [ ] **Reverse engineering:** an existing part, given as STL or STEP, rebuilt as a parametric model that matches it. *Stresses:* import, measuring against a reference, comparing two shapes, sketches on imported faces.
- [ ] **A configurable product family:** one parametric part (a bracket, a box, a Lego-compatible brick) in fifty configurations, each drawn and exported. *Stresses:* configurations at scale, drawings of configurations, batch exports through scripts, regeneration time.
- [ ] **Two agents on one project:** one models the parts, one the assembly and drawings, syncing through git. *Stresses:* git sync and merges in parallel, the app following changes from other processes, conflicts, versions.
- [ ] **A thousand-feature part:** a long timeline (a panel with hundreds of vents, a detailed housing) edited near its start. *Stresses:* regeneration time, naming that holds through many features, the timeline's interface, memory.
- [ ] **Only the app, no MCP:** an agent (or a person new to CADence) builds a part and its drawing through the app's interface alone, through computer use. *Stresses:* the interface itself: discoverability, picking, dialogs and the user guide.

## Your additions

-
