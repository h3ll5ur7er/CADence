---
id: CAD-15
title: Persistent references and sketch on face
type: feature
status: done
priority: high
---

Solve the topological naming problem as designed in [[Architecture/Document model#Persistent references]] ([[Architecture/Decisions#ADR-15]]).

- [x] Generative naming per feature (caps, sides by source curve, rounds, copies) and inheritance by surface identity
- [x] Resolution by name, then among split pieces by position; lost references fail with "pick it again"
- [x] Sketch on a planar face (moves with the face); planes oriented like the origin planes
- [x] Regression tests: upstream edits keep downstream references (fillet survives thickness changes)
- [x] Face and edge picking in the viewport with hover and selection highlights
- [ ] ~~Project edges into sketches~~: moved to [[CAD-29]]
