---
id: CAD-93
title: Simple strength check (FEA)
type: feature
status: done
priority: medium
---

A linear static analysis of a part.

- [x] Tetrahedral mesh of a body; fixed faces and loads (forces, pressure) on faces
- [x] Stress and deflection shown on the part, with a safety factor from the material
- [x] Validated against textbook cases (cantilever beam, plate with hole)

Quadratic tetrahedra on a grid of cubes whose boundary nodes are moved onto the surface, solved by
conjugate gradients ([[Architecture/Decisions#ADR-41]]); the solver is [[src/core/engines/analysis/fea.ts]].
Slender parts (thin plates, long beams) need many solver steps: a candidate for [[CAD-95]].
