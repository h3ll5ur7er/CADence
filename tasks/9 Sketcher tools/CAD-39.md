---
id: CAD-39
title: More relations and snapping
type: feature
status: done
priority: medium
---

- [x] Symmetric, concentric, collinear relations
- [x] Horizontal and vertical alignment of two points
- [x] Snapping to points, curves, midpoints and centres while drawing, creating the matching relation (point on a line gives a coincidence)

Snapping: [[src/app/editor/sketch/snapping.ts]]. Tangency at a shared end point now uses angle-via-point, which also makes slots and fillets solve.
