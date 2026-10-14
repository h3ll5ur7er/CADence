---
id: CAD-11
title: Export sketches as DXF and SVG
type: feature
status: done
priority: medium
---

UC5: export a sketch as DXF and SVG for laser cutting.

- [x] Interchange Engine with a format registry; DXF (R12 LINE, ARC, CIRCLE; mm) and SVG (mm, Y up, hairline) writers
- [x] External File Access: download in the browser, native save dialog on desktop (Tauri dialog plugin)
- [x] Round-trip test against `dxf-parser`; SVG checked as XML ([[src/core/engines/interchange/interchange-engine.spec.ts]])
- [x] Playwright saves real exports to `e2e/evidence/plate.dxf` and `plate.svg`

Not verified automatically: the desktop save dialog is a native window, outside what the WebView automation can reach.
