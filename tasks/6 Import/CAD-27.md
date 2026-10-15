---
id: CAD-27
title: Import DXF and SVG into sketches
type: feature
status: done
priority: medium
---

- [x] DXF and SVG readers producing sketch entities (lines, arcs, circles, polylines with bulges as arcs; splines, ellipses and Béziers as lines within 0.05 mm)
- [x] Import as an imported document and insert into a sketch (Insert drawing; one undoable change; meeting ends share points)
- [x] Extrude preselects the outline without the profiles that fill its holes
- [x] Evidence: `e2e/evidence/27-imported-svg.png`, `plate-converted.dxf`

Not done: fitting arcs to Béziers and splines (they become lines); DXF blocks (INSERT), text and hatches are skipped.
