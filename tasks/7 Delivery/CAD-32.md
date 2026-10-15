---
id: CAD-32
title: Web app on GitHub Pages, offline and installable
type: feature
status: done
priority: high
---

Publish the browser app from `master` on GitHub Pages, and let it run offline once loaded.

- [x] Production build that works below a sub-path (`/CADence/`): base href, worker and WebAssembly URLs, deep links (404 fallback)
- [x] Pages workflow that builds and deploys `master`
- [x] Service worker (web only, never on desktop): app shell cached up front, the 23 MB kernel cached on first use
- [x] Web app manifest and icons, so the app can be installed
- [x] An update notice when a new version is ready
- [x] Tests: the update notice; a Playwright journey against the Pages build (sub-path, deep link, manifest, offline modeling)

The Pages journey ([[e2e/pages/offline.spec.ts]]) builds for `/CADence/`, opens a deep link, then models a part with the network switched off. Publishing needs *Settings → Pages → Source: GitHub Actions* once, then a push to `master`. Decision: [[Architecture/Decisions#ADR-23]].
