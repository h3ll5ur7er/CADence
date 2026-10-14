---
id: CAD-7
title: Tauri desktop shell
type: feature
status: done
priority: medium
---

Run the same app as a desktop application ([[Architecture/Decisions#ADR-4]]).

- [x] `src-tauri` with Tauri 2 (`npm run desktop`, `npm run desktop:build`), app icon, 1440×900 window, strict CSP
- [x] `FileSystem` port in the core; folder implementations of Project, Document and Asset Access passing the same contract tests (Node file system in tests)
- [x] Tauri `FileSystem` adapter in `src/app/platform/`, fs plugin scoped to the app data folder
- [x] Desktop composition root chosen at start-up (`isTauri()`); status bar shows where projects are stored
- [x] Evidence: desktop window screenshot (`e2e/evidence/07-desktop.png`)
- [ ] ~~External File Access via the dialog plugin~~: moved to [[CAD-11]], the first task that exports files (YAGNI). Importing works with the web file picker in the desktop app too.

The production build disables critical-CSS inlining: its inline `onload` script would be blocked by the desktop CSP, leaving the app unstyled.
