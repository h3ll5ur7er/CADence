---
id: CAD-14
title: Timeline regeneration with extrude and revolve
type: feature
status: done
priority: high
---

UC2 and UC3: features driven by sketches and parameters, regenerated incrementally.

- [x] Design Manager regeneration of the whole timeline on every command ([[src/core/managers/design/regeneration.ts]])
- [x] Extrude (normal, reverse, symmetric) and revolve (origin axis, sketch construction line or edge)
- [x] Boolean operations: new body, join, cut, intersect
- [x] Timeline UI: edit, suppress, rename, delete; per-item failure state with the reason
- [x] Outcome caching by content hash in the worker, mesh caching by body key; tests on volumes
- [x] Hover and select profiles in the viewport (moved here from [[CAD-10]])
- [ ] ~~Reorder and roll back~~: moved to [[CAD-28]]
- [ ] ~~Publish the component result~~: moved to [[CAD-22]], where assemblies consume it
