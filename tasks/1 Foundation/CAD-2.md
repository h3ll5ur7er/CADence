---
id: CAD-2
title: Scaffold workspace with enforced layers
type: chore
status: todo
priority: high
---

Set up the Angular 22 workspace and the `src/core` layer skeleton as described in [[Architecture#Code layout]].

- [ ] Angular 22 app: standalone, zoneless, strict TypeScript, routing, SCSS
- [ ] `src/core/{contracts,managers,engines,access,utilities,composition}` skeleton
- [ ] ESLint with import-boundary rules enforcing [[Architecture#Call rules]] (with a test that a violating fixture fails)
- [ ] Vitest for core and components; Playwright for end to end with evidence screenshots in `e2e/evidence/`
- [ ] npm scripts: `start`, `build`, `test`, `lint`, `e2e`
