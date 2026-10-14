# CADence

CADence is a parametric 3D CAD application for makers. It covers the things you build at home with **3D printers and laser cutters**. It runs in the browser and as a desktop application (Tauri), and it is built with Angular 22, a WebAssembly geometry kernel (OpenCascade), and WebGPU rendering.

## What it does

- **Projects** hold any number of documents. The home page lists all projects, and opening one brings up the editor.
- The **editor** has three modes, one per document kind:
  - **Component**: parametric part modeling. You draw 2D sketches on planes or faces, then extrude, revolve, fillet, shell, pattern and so on, all driven by variables, constraints and dimensions.
  - **Assembly**: components placed with joints, which can be animated and simulated.
  - **Imported**: files brought in from elsewhere (STEP, STL, OBJ, DXF, SVG and others).
- **Export**: STEP, STL, OBJ (and 3MF) for 3D models; DXF and SVG for sketches and 2D drawings.

## Where to read next

- [[Architecture]]: the iDesign architecture, decomposed by volatility
  - [[Architecture/Volatility analysis]]
  - [[Architecture/Components]]
  - [[Architecture/Use cases and call chains]]
  - [[Architecture/Document model]]
  - [[Architecture/Decisions]]
- [[Roadmap]]: the phases and their tasks
- [[Development]]: run, test and build the web and desktop apps
- [[Conventions]]: code, testing, git and the definition of done
