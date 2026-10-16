---
id: CAD-59
title: Desktop installers
type: feature
status: done
priority: medium
---

Installable desktop builds instead of the bare executable.

- [x] MSI and NSIS installers from `tauri build`, built in CI and attached to releases
- [x] Code signing (when a certificate is available; documented otherwise): documented in [[Development#Releases]], needs a certificate
- [x] Auto-update from GitHub releases
- [x] One version everywhere (`tools/release/version.mjs`), checked by a test; tags start the release workflow
- [x] Update notice in the desktop app (install and restart)
