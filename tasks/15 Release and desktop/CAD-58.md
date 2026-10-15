---
id: CAD-58
title: Desktop smoke tests in the repository
type: feature
status: todo
priority: medium
---

The desktop checks that run by hand today become scripts in the repository, run in CI on Windows.

- [ ] Start the built desktop app and drive it (WebView2 remote debugging): create a project, model, reopen
- [ ] The native save dialog under test: exports on desktop write the chosen file
- [ ] A CI job on a Windows runner
