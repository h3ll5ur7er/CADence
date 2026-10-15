---
id: CAD-12
title: Geometry worker with OCCT and Shape Access
type: feature
status: done
priority: high
---

Bootstrap OCCT (`replicad-opencascadejs`) in a Web Worker behind the Modeling Engine proxy ([[Architecture#Deployment and threads]], [[Architecture/Decisions#ADR-16]]).

- [x] Messaging: typed worker RPC with transferables ([[src/core/utilities/messaging/rpc.ts]])
- [x] Geometry worker hosting the kernel-bound engines ([[src/workers/geometry.worker.ts]]); WASM served from `/wasm/`, loaded lazily; in-process in Node tests; works in Tauri
- [x] Shape Access: kernel start-up and an LRU cache of named shapes that frees WebAssembly memory
- [x] Tessellation to `BodyMesh` with named face ranges and edge polylines
- [x] Start-up time: OCCT initialises in about 0.1 s in Node; the 23 MB WASM is fetched once and cached by the browser
