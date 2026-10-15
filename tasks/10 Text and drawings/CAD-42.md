---
id: CAD-42
title: Imported drawings as one piece, arcs, blocks and hatches
type: feature
status: done
priority: medium
---

- [x] Fit arcs to Béziers and splines instead of short lines (exact where the curve allows, else lines and arcs within 0.01 mm)
- [x] DXF blocks (`INSERT`: scaled, turned, nested, arrayed) and hatch boundaries
- [x] An inserted drawing keeps its ratios: moving, rotating and scaling act on the whole drawing (option on insert: two handle points)
- [x] Constraints for imported drawings: fix them, or infer horizontal, vertical and tangent (coincident through shared points)

Decision: [[Architecture/Decisions#ADR-27]]. Journey: [[e2e/text-and-drawings.spec.ts]] (evidence 45).
