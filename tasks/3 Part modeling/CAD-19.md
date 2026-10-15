---
id: CAD-19
title: Export bodies as STEP, STL, OBJ and 3MF
type: feature
status: done
priority: high
---

UC4: export solid bodies for printing and exchange.

- [x] STEP via OCCT (one named solid per body); binary STL, OBJ and 3MF (a stored-entry ZIP) writers
- [x] Export menu in the component editor; files named after the component
- [x] Tests: STEP re-imports to the same volume; meshes enclose the same volume ([[src/core/engines/interchange/interchange-engine.spec.ts]])
- [ ] ~~Export dialog (choose bodies, mesh quality)~~: moved to [[CAD-30]]
