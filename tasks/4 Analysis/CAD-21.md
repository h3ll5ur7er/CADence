---
id: CAD-21
title: Manufacturability validation
type: feature
status: todo
priority: medium
---

UC8: check parts for FDM/SLA printing and laser cutting.

- [ ] Manufacturing profiles (printer bed, nozzle, layer height; laser bed, kerf, material thickness)
- [ ] Checks: closed solid, minimum wall thickness, overhangs, bed fit; for sketches: closed profiles, kerf compensation
- [ ] Results highlighted in the viewport
- [ ] Profile the mesh analysis; move it to Rust/WASM if TypeScript is too slow ([[Architecture/Decisions#ADR-8]])
