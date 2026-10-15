---
id: CAD-47
title: Stable names for freeform faces
type: improvement
status: done
priority: low
---

B-spline faces today match only by centre and area (ADR-15).

- [x] Name freeform faces by the feature and the profile curve that made them (loft and sweep from the kernel's history; extrude and revolve by a point the face passes through); trimmed freeform faces keep their names (probe points on the same surface)
- [x] Tests: references on loft and sweep faces survive edits of their profiles, and holes cut through them
