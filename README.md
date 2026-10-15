# CADence

Parametric 3D CAD for makers: 3D printing and laser cutting. It runs in the browser, at https://h3ll5ur7er.github.io/CADence/ and offline once loaded, and as a desktop app (Tauri), built with Angular 22, OpenCascade (WebAssembly) and WebGPU.

```bash
npm install
npm start            # web app on http://localhost:4200
npm run desktop      # desktop app
npm run verify       # lint, typecheck, tests, production build
npm run e2e          # end-to-end tests with evidence screenshots
npm run e2e:pages    # the GitHub Pages build: sub-path, deep links, offline
```

Documentation lives in the wiki at [docs/Home.md](docs/Home.md): architecture, decisions, conventions and how to develop. Planned and finished work is tracked as tasks in [tasks/](tasks).
