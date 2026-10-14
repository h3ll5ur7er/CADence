---
id: CAD-6
title: Editor shell with modes and 3D viewport
type: feature
status: todo
priority: high
---

Opening a document routes to the editor in the mode that matches its kind ([[Architecture/Components#Clients]]).

- [ ] Lazy routes: component, assembly and imported editors inside a common shell (toolbar, tree, properties panel)
- [ ] Viewport: three.js `WebGPURenderer` with WebGL2 fallback, grid, origin planes and axes, orbit/pan/zoom, standard views
- [ ] Render-on-demand loop outside change detection
- [ ] Renderer backend (WebGPU / WebGL2) shown in the status bar
- [ ] Playwright evidence of each mode
