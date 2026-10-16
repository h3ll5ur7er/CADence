---
id: CAD-94
title: Performance on large models and assemblies
type: feature
status: done
priority: medium
---

Measure and optimise for big models.

- [x] Benchmarks of large parts and assemblies (regeneration, meshing, rendering, memory): `npm run bench`, `e2e/performance.spec.ts`
- [x] Optimisations where they pay: sketches split into independent parts, profiles with many holes, linear face and edge listing, the printability mesh, the strength check's solver, geometry shared between instances

Results and what is left: [[Architecture/Performance]]. Meshing already runs in the geometry worker; level of detail and instanced drawing did not pay yet (see the page).
