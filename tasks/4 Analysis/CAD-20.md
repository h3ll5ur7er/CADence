---
id: CAD-20
title: Measure and mass properties
type: feature
status: done
priority: medium
---

Measure tool and mass properties in the component editor ([[User-guide/Measuring-and-checking]]). The Analysis Engine ([[src/core/engines/analysis/index.ts]]) runs in the geometry worker. The Design Manager offers `measure` and `properties`, and the material is part of the document ([[Architecture/Decisions#ADR-19]]).

- [x] Distance, angle, length, area and radius between picked references
- [x] Volume, mass from material density, centre of mass, bounding box
- [x] Material choice saved in the document (`set-material`, undoable)
- [x] Distance drawn in the viewport between the closest points
- [x] Evidence: `e2e/evidence/16-mass-properties.png`, `17-measure.png`
