---
id: CAD-6
title: Editor shell with modes and 3D viewport
type: feature
status: done
priority: high
---

Opening a document routes to the editor in the mode that matches its kind ([[Architecture/Components#Clients]]).

- [x] Editor shell: breadcrumb top bar with mode chip, documents panel, status bar; each mode lazy-loaded with `@defer`
- [x] Component, assembly and imported modes with their model browsers and properties panels
- [x] Viewport: three.js `WebGPURenderer` with automatic WebGL 2 fallback (`?webgl` forces it), Z-up camera, grid (10/50 mm), origin axes and planes, orbit/pan/zoom with damping
- [x] View cube (CSS 3D, mirrors the camera) with clickable standard views and a home view
- [x] Render-on-demand loop outside change detection
- [x] Renderer backend (WebGPU / WebGL 2) shown in the status bar
- [x] Playwright evidence of each mode in `e2e/evidence/`
