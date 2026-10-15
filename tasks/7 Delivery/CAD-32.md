---
id: CAD-32
title: Web app on GitHub Pages, offline and installable
type: feature
status: todo
priority: high
---

Publish the browser app from `master` on GitHub Pages, and let it run offline once loaded.

- [ ] Production build that works below a sub-path (`/CADence/`): base href, worker and WebAssembly URLs, deep links (404 fallback)
- [ ] Pages workflow that builds and deploys `master`
- [ ] Service worker (web only, never on desktop): app shell cached up front, the 23 MB kernel cached on first use
- [ ] Web app manifest and icons, so the app can be installed
- [ ] An update notice when a new version is ready
- [ ] Tests: the build below a sub-path, the service worker registration rules; offline journey in Playwright
