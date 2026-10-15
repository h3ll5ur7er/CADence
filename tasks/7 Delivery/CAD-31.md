---
id: CAD-31
title: Merge into master and continuous integration
type: chore
status: done
priority: high
---

Bring the phase branches into `master` and check every push on GitHub.

- [x] Fast-forward `master` to the last phase branch (the phases are one line of history)
- [x] GitHub Actions workflow: `npm ci`, `npm run verify`, Playwright journeys in Chromium
- [x] Evidence and the Playwright report kept as workflow artifacts
- [x] Wiki: how CI runs and where its results are

Merged: `master` was fast-forwarded to the end of phase 6. The workflow passes `actionlint`, and every step was run locally (also without a GPU, as on the runners); it runs on GitHub with the next push. See [[Development#Continuous integration and deployment]].

Confirmed on GitHub: the journeys pass in CI (software WebGL, one worker). Merging both phase branches left a duplicate function in the viewport; fixed in pull request #10.
