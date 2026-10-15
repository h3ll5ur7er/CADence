---
id: CAD-21
title: Manufacturability validation
type: feature
status: done
priority: medium
---

UC8: check parts for FDM printing and laser cutting ([[Architecture/Use-cases-and-call-chains#UC8: Validate for 3D printing or laser cutting]], [[User-guide/Measuring-and-checking]]).

- [x] Manufacturing profiles (printer bed, nozzle, layer height, overhang angle; laser bed, kerf, material thickness), presets plus custom values, stored in the document (`set-process`)
- [x] Checks: closed solid, minimum wall thickness, overhangs, bed fit; for sketches: closed profiles, kerf compensation; for laser bodies: sheet thickness
- [x] Kerf-compensated DXF/SVG export (outlines offset by half the kerf, sharp corners)
- [x] Results highlighted in the viewport (faces of the focused check)
- [x] Profile the mesh analysis; move it to Rust/WASM if TypeScript is too slow ([[Architecture/Decisions#ADR-8]]). Measured: OCCT meshing dominates and TypeScript ray casting is about 11 % of a check, so it stays in TypeScript, with meshes cached by shape key ([[Architecture/Decisions#ADR-18]])
- [x] Evidence: `e2e/evidence/18-check-print.png`, `19-check-laser.png`, `20-check-overhang.png`, `plate-kerf.dxf`

Not covered: resin (SLA) printers. Their rules differ (no nozzle; drain holes and suction cups instead), so they need a profile kind of their own when someone asks for it.
