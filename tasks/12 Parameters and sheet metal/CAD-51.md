---
id: CAD-51
title: Sheet metal
type: feature
status: done
priority: medium
---

- [x] Sheet metal rules per component: thickness, bend radius, K-factor (held by its base flange)
- [x] Base flange from a sketch, edge flanges on straight edges of the sheet (length, angle)
- [x] Flat pattern (unfold by the bend allowance) with bend lines on their own layer (DXF `BEND`, a dashed SVG group), exported to DXF/SVG for laser cutting

Flanges on flanges cannot be unfolded yet, and corners get no relief cuts. Decision: [[Architecture/Decisions#ADR-29]].
