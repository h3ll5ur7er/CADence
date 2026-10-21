# Roadmap

The work is planned in phases. Each phase ends with a running demo and visible evidence ([[Conventions#Definition of done]]). Every phase is an epic folder in `tasks/`.

| Phase | Goal | Tasks |
| --- | --- | --- |
| 0. Architecture ✅ | iDesign architecture, volatility analysis, decisions, backlog | [[CAD-1]] |
| 1. Foundation ✅ | Workspace with enforced layers; projects on the home page; editor shell with modes and a 3D viewport; desktop build | [[CAD-2]] [[CAD-3]] [[CAD-4]] [[CAD-5]] [[CAD-6]] [[CAD-7]] |
| 2. Sketcher ✅ | Constraint-based 2D sketching on planes, profiles, DXF/SVG export | [[CAD-8]] [[CAD-9]] [[CAD-10]] [[CAD-11]] |
| 3. Part modeling ✅ | OCCT geometry worker, parameters, extrude/revolve, timeline regeneration, persistent references, undo/redo, STEP/STL/OBJ/3MF export; follow-ups [[CAD-28]] [[CAD-29]] [[CAD-30]] | [[CAD-12]] [[CAD-13]] [[CAD-14]] [[CAD-15]] [[CAD-16]] [[CAD-17]] [[CAD-18]] [[CAD-19]] |
| 4. Analysis ✅ | Measure, mass properties, printability and laser-cut validation, kerf-compensated export | [[CAD-20]] [[CAD-21]] |
| 5. Assemblies ✅ | Instances, joints, kinematics, motion studies, interference, assembly export | [[CAD-22]] [[CAD-23]] [[CAD-24]] [[CAD-25]] |
| 6. Import ✅ | STEP/STL/OBJ/3MF import and the imported viewer with conversion; imported bodies in components and assemblies; DXF/SVG into sketches | [[CAD-26]] [[CAD-27]] |
| 7. Delivery ✅ | `master` holds every phase; CI on GitHub; the web app on GitHub Pages, offline and installable; browser journeys for every feature | [[CAD-31]] [[CAD-32]] [[CAD-33]] |
| 8. Viewport ✅ | Zoom to fit, orthographic and section views; show, hide and colour bodies; vertex picks; shortcuts and control schemes | [[CAD-34]] [[CAD-35]] [[CAD-36]] |
| 9. Sketcher tools ✅ | Slot, polygon, ellipse, spline and more; trim, extend, offset, fillet; more relations and snapping; box selection, copy and paste; projected edges, sketch patterns | [[CAD-37]] [[CAD-38]] [[CAD-39]] [[CAD-40]] [[CAD-29]] |
| 10. Text and drawings ✅ | Text in sketches, on faces and in imported drawings; imported drawings as one piece, with arcs, blocks, hatches and constraints | [[CAD-41]] [[CAD-42]] |
| 11. Part modeling II ✅ | Timeline reorder and rollback; more planes and export options; loft, sweep, path patterns; holes and threads; draft, rib, variable fillet; body operations; freeform names | [[CAD-28]] [[CAD-30]] [[CAD-43]] [[CAD-44]] [[CAD-45]] [[CAD-46]] [[CAD-47]] |
| 12. Parameters and sheet metal ✅ | Display units, project parameters, configurations, sheet metal with flat patterns | [[CAD-48]] [[CAD-49]] [[CAD-50]] [[CAD-51]] |
| 13. Projects ✅ | Thumbnails, git-based version history with named versions, git sync | [[CAD-52]] [[CAD-53]] [[CAD-54]] |
| 14. Automation ✅ | Scripting API and command line, MCP server for AI agents | [[CAD-55]] [[CAD-56]] |
| 15. Release and desktop ✅ | About dialog with licence credits; desktop smoke tests in CI; installers and auto-update | [[CAD-57]] [[CAD-58]] [[CAD-59]] |
| 16. Projects II ✅ | Drag and drop, duplicates; replacing imported files; project archives and file associations; synced version names; templates; sharing a model as one HTML file | [[CAD-60]] [[CAD-61]] [[CAD-62]] [[CAD-63]] [[CAD-64]] [[CAD-65]] |
| 17. Sketcher III ✅ | Tracing pictures and turning them into outlines; sketch diagnostics (open degrees of freedom, conflicts, suggestions); equation curves; more fonts and text along curves | [[CAD-66]] [[CAD-67]] [[CAD-68]] [[CAD-69]] [[CAD-70]] |
| 18. Part modeling III ✅ | Standard parts library, gear generator, print-friendly generators, clearances for prints | [[CAD-71]] [[CAD-72]] [[CAD-73]] [[CAD-74]] |
| 19. Workflow ✅ | Timeline folders and notes, repairing broken references, configurations as CSV, command palette | [[CAD-75]] [[CAD-76]] [[CAD-77]] [[CAD-78]] |
| 20. Assemblies II ✅ | Dragging parts and joint offsets, measuring and mass of assemblies, instance patterns, live updates | [[CAD-79]] [[CAD-80]] [[CAD-81]] [[CAD-82]] |
| 21. Motion and assembly documents ✅ | Motion links, smoother motion with collisions, exploded views and instructions, bill of materials | [[CAD-83]] [[CAD-84]] [[CAD-85]] [[CAD-86]] |
| 22. Technical drawings ✅ | Drawing documents with views, dimensions and notes, callouts and parts lists; PDF and DXF | [[CAD-87]] [[CAD-88]] [[CAD-89]] |
| 23. Visuals ✅ | Materials and lighting, picture and video export, surface analysis, pictures for agents | [[CAD-90]] [[CAD-91]] [[CAD-92]] |
| 24. Simulation ✅ | A simple strength check (linear static FEA) | [[CAD-93]] |
| 25. Performance ✅ | Large models and assemblies; Rust/WASM where profiling shows a need | [[CAD-94]] [[CAD-95]] |
| 26. Stress-test findings ✅ | What modelling a radial engine through the MCP server found ([[CAD-96]], [[Magnum opus]]): assemblies, lean answers and pictures of motion for agents; ring gears, smooth teeth and cams; booleans, threads, lofts and names that hold | [[CAD-97]] [[CAD-98]] [[CAD-99]] [[CAD-100]] [[CAD-101]] [[CAD-102]] [[CAD-103]] [[CAD-104]] [[CAD-105]] [[CAD-106]] [[CAD-107]] [[CAD-108]] |
| 27. Stress-test findings II ✅ | The radial engine's second round ([[CAD-96]]): pictures, animations, exploded views and collision checks of large assemblies with pattern copies; joint frames, tilted offsets, lean assembly answers; the reopened naming case | [[CAD-104]] [[CAD-109]] [[CAD-110]] [[CAD-111]] [[CAD-112]] [[CAD-113]] [[CAD-114]] [[CAD-115]] |
| 28. Stress-test findings III ✅ | The radial engine's third round ([[CAD-96]]): open assemblies follow their components' changes in every process; joint frames from exact geometry; leaned offsets and clearer refusals; result files written whole | [[CAD-116]] [[CAD-117]] [[CAD-118]] [[CAD-119]] |
| 29. Agents can do everything ✅ | Every manager operation for agents: drawings, projects, versions, git, measuring, sketch checks, viewers, tables and build instructions, section pictures; loops that keep their branch, shapes held by open documents, steady animations | [[CAD-120]] [[CAD-121]] [[CAD-122]] [[CAD-123]] [[CAD-124]] |
| 30. Drawings of the engine ✅ | The radial engine's drawings ([[CAD-96]], round 5): views within a time limit, drawn from the triangles when the exact projection takes too long, and kept with the drawing; views of configurations; outlines, centres, leader angles, extremes and section lines to dimension; short anchor answers for agents | [[CAD-125]] [[CAD-126]] [[CAD-127]] [[CAD-128]] [[CAD-129]] [[CAD-130]] |
| 31. A binary for agents ✅ | The command line and MCP server as one self-contained executable with the kernels and fonts inside, for agents of other projects | [[CAD-131]] |
| 32. Releases for every system ✅ | Installers for Windows, macOS and Linux from each version tag, each with the command line for agents next to the app; the command line on its own per system; the About dialog says how to add it to Claude Code | [[CAD-132]] |
| 33. The keyboard enclosure's findings ✅ | Fixes for what an agent found modelling a keyboard enclosure: a kernel that recovers, an MCP server that answers side by side and can be cancelled, a schema an older app refuses, project parameters and version histories that carry over, sturdier booleans and extrudes, sketches that stay on their faces, gears that print | [[CAD-133]] … [[CAD-147]] |
| 34. Projects III ✅ | A trash; notes and attachments with projects; the desktop app follows what agents change on disk; libraries shared between projects, and standard parts as assembly instances from one | [[CAD-148]] [[CAD-149]] [[CAD-150]] [[CAD-151]] [[CAD-152]] |
| 35. Sketcher IV ✅ | Reference dimensions, reusable sketch blocks, sketches wrapped onto curved faces | [[CAD-153]] [[CAD-154]] [[CAD-155]] |
| 36. Part modeling IV ✅ | Ribs up to the next face and drill points; nested timeline folders and repairs matched by shape; a material per body | [[CAD-156]] [[CAD-157]] [[CAD-158]] |
| 37. Gears and springs ✅ | Root fillets on ring gears and profile-shifted gears; bevel and worm gears; helices and springs | [[CAD-159]] [[CAD-160]] [[CAD-161]] |
| 38. Sheet metal II ✅ | Flanges on flanges in the flat pattern and corner reliefs; hems and miter flanges | [[CAD-162]] [[CAD-163]] |
| 39. Drawings III ✅ | Offset and half sections; tolerances, surface finish and true-length dimensions; cosmetic threads; anchors on cones, spheres, free-form faces and assembly parts; exact views finishing in the background | [[CAD-164]] [[CAD-165]] [[CAD-166]] [[CAD-167]] [[CAD-168]] |
| 40. Import II | Solids from large and broken meshes; circuit boards from KiCad | [[CAD-169]] [[CAD-170]] |
| 41. Automation III | Whole scripts through MCP; MCP resources and prompts; a script console in the app; plugins | [[CAD-171]] [[CAD-172]] [[CAD-173]] [[CAD-174]] |
| 42. Versions and collaboration | Comparing versions; three-way merges inside a document; users, sign-in and sharing (a server, decided first); real-time collaboration | [[CAD-175]] [[CAD-176]] [[CAD-177]] [[CAD-178]] |
| 43. Anywhere | A phone-friendly viewer, augmented reality, onboarding | [[CAD-179]] [[CAD-180]] [[CAD-181]] |

The order follows the dependencies: the Sketcher needs the editor shell, Part modeling needs profiles, and Assemblies need regenerated components. Within a phase, tasks are listed in the order they will be done.

Phases 7 to 14 come from the points checked in [[Open points]]: delivery first, so every later phase is built and published by CI; then the viewport and the sketcher, which later modeling features build on; text before the features that use it; projects and automation last, since they wrap everything else.

Phases 15 to 25 come from the second round of [[Open points]]: release obligations and the desktop first; then projects (archives come before file associations), the sketcher and part modeling, which drawings and assemblies build on; assemblies before technical drawings, whose parts lists use the bill of materials; visuals, simulation and performance last, measured on everything before them.

Phases 34 to 43 come from the third round of [[Open points]]: projects first, since libraries are what standard parts, sketch blocks and plugins are shared through, and since agents' work should show in the desktop app while the rest is built; then the sketcher and part modeling, gears and sheet metal, which drawings show; drawings before import and automation, which use everything else; versions and collaboration late, as users and sharing need a server that is decided first ([[CAD-177]]); the phone viewer and onboarding last, since they show and explain all of it.

Two stress tests run beside the phases, through the MCP server like the radial engine: a six-axis robot arm ([[CAD-182]]) and a Stewart platform ([[CAD-183]]). Their findings become phases of their own, as the radial engine's became phases 26 to 28.
