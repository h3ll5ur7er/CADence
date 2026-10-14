---
id: CAD-5
title: Project Manager and home page
type: feature
status: done
priority: high
---

UC1 from [[Architecture/Use cases and call chains]]: on start-up the home page lists all projects. Projects and their documents can be created, renamed, deleted and opened.

- [x] Project Manager with unit tests against in-memory access ([[src/core/managers/project/project-manager.spec.ts]])
- [x] Composition root (`createBrowserCore`, `createInMemoryCore`) and the `PROJECT_MANAGER` injection token
- [x] Home page: project grid, empty state, create/rename/delete dialogs (native `<dialog>`)
- [x] New projects start with "Component 1" and open straight in the editor; opening a project shows its most recently edited document
- [x] Documents panel in the editor: grouped by kind, create component/assembly, import, rename, delete
- [x] Minimal import: the original file is kept through Asset Access and an imported document records its format and size (preview in [[CAD-26]])
- [x] Playwright: create a project, documents of every kind, rename, reload, still listed; delete with confirmation
