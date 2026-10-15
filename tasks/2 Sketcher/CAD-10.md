---
id: CAD-10
title: Profile detection
type: feature
status: done
priority: high
---

Find closed regions (with holes) in a solved sketch, for features to consume ([[src/core/engines/sketch/profiles.ts]]).

- [x] Planar graph of non-construction curves, split at intersections; dangling edges pruned
- [x] Face tracing with tangent and curvature order at vertices; exact areas; islands as holes
- [x] Stable profile ids (derived from bounding curves)
- [x] Profiles shaded in the sketch editor and in 3D; areas in the properties panel
- [ ] Hover and select individual profiles: moved to [[CAD-14]], where extrude needs it
