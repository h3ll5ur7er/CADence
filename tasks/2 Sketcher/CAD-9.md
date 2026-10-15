---
id: CAD-9
title: Sketch editing in the component editor
type: feature
status: done
priority: high
---

Create and edit sketches on origin planes through Design commands. How it works for users: [[User guide/Sketching]].

- [x] Design Manager: sessions, sketch commands, atomic solve-or-reject, undo/redo, immediate save ([[Architecture/Components#Design Manager]])
- [x] Tools: line (chained), rectangle, circle, arc, point, construction toggle, delete
- [x] Snapping to points (incl. the origin) and automatic horizontal/vertical inference
- [x] Constraint tools enabled by the selection; constraint badges on the geometry
- [x] Dimensions with expressions, typed in place on the label
- [x] Colour by status (under-constrained blue, fully constrained text colour); drag points with live solving
- [x] SVG overlay editor on a plane-locked camera ([[Architecture/Decisions#ADR-12]]); finished sketches drawn in 3D
- [x] Refuse conflicting or degenerate changes with an explanation ([[Architecture/Decisions#ADR-13]])
- [x] Playwright: draw, constrain, drag, export, undo/redo, reload ([[e2e/sketcher.spec.ts]])
