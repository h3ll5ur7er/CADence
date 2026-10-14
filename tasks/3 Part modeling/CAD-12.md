---
id: CAD-12
title: Geometry worker with OCCT and Shape Access
type: feature
status: todo
priority: high
---

Bootstrap OCCT (`replicad-opencascadejs`) in a Web Worker behind the Modeling Engine proxy ([[Architecture#Deployment and threads]]).

- [ ] Messaging: typed worker RPC with transferables
- [ ] Geometry worker hosting the kernel-bound engines; WASM loading in the browser, Node tests and Tauri
- [ ] Shape Access over the in-worker shape cache
- [ ] Tessellation to MeshDTO (positions, normals, indices, face/edge ranges with ids)
- [ ] Measure kernel start-up time and memory
