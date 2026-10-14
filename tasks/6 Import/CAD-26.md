---
id: CAD-26
title: Import 3D files and imported viewer
type: feature
status: done
priority: high
---

UC6: import STEP, STL, OBJ and 3MF into a project ([[User-guide/Importing]], [[Architecture/Decisions#ADR-22]]).

- [x] Asset Access (browser and desktop) with contract tests
- [x] Project Manager importFile workflow; originals kept through Asset Access
- [x] Interchange readers: STEP (OCCT), STL (binary and ASCII), OBJ, 3MF (deflated, units, components, transforms)
- [x] Imported viewer with metadata, conversion and export (fit to view, volume, size, triangles)
- [x] Use imported bodies as references in components (Insert body feature) and assemblies (instances)
- [x] Architecture rule: no kernel code on the main thread (the start-up bundle stays at 94 kB)
- [x] Evidence: `e2e/evidence/26-imported-step.png`, `28-built-from-imports.png`, `29-desktop-import.png`, `bracket-converted.stl`

Limit: meshes above 100,000 triangles are viewed and converted between mesh formats but not turned into solids.
