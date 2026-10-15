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
| 12. Parameters and sheet metal | Display units, project parameters, configurations, sheet metal with flat patterns | [[CAD-48]] [[CAD-49]] [[CAD-50]] [[CAD-51]] |
| 13. Projects | Thumbnails, git-based version history with named versions, git sync | [[CAD-52]] [[CAD-53]] [[CAD-54]] |
| 14. Automation | Scripting API and command line, MCP server for AI agents | [[CAD-55]] [[CAD-56]] |

The order follows the dependencies: the Sketcher needs the editor shell, Part modeling needs profiles, and Assemblies need regenerated components. Within a phase, tasks are listed in the order they will be done.

Phases 7 to 14 come from the points checked in [[Open points]]: delivery first, so every later phase is built and published by CI; then the viewport and the sketcher, which later modeling features build on; text before the features that use it; projects and automation last, since they wrap everything else.
