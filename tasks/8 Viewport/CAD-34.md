---
id: CAD-34
title: Camera: zoom to fit, orthographic view, section view
type: feature
status: done
priority: medium
---

- [x] Zoom to fit in component and assembly mode (button and shortcut)
- [x] Orthographic camera as an option to perspective, kept per user
- [x] Section view: a cutting plane on a principal or picked plane, with an offset; caps on the cut

All three in the viewport, for every mode: buttons under the view cube and keys (F, O, Shift+X in the CADence style). The cut surface is drawn from the bodies' inside faces in the section colour ([[Architecture/Decisions#ADR-24]]). Journey: [[e2e/viewport.spec.ts]].
