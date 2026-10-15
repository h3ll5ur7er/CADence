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
| 6. Import | STEP/STL/OBJ/3MF import and the imported viewer; DXF/SVG into sketches | [[CAD-26]] [[CAD-27]] |

The order follows the dependencies: the Sketcher needs the editor shell, Part modeling needs profiles, and Assemblies need regenerated components. Within a phase, tasks are listed in the order they will be done.
