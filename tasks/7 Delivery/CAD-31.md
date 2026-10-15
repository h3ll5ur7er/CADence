---
id: CAD-31
title: Merge into master and continuous integration
type: chore
status: todo
priority: high
---

Bring the phase branches into `master` and check every push on GitHub.

- [ ] Fast-forward `master` to the last phase branch (the phases are one line of history)
- [ ] GitHub Actions workflow: `npm ci`, `npm run verify`, Playwright journeys in Chromium
- [ ] Evidence and the Playwright report kept as workflow artifacts
- [ ] Wiki: how CI runs and where its results are
