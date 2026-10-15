---
id: CAD-2
title: Scaffold workspace with enforced layers
type: chore
status: done
priority: high
---

Set up the Angular 22 workspace and the `src/core` layer skeleton as described in [[Architecture#Code layout]].

- [x] Angular 22 app: standalone, zoneless, strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), routing, SCSS
- [x] `src/core` layers with the `@core/*` path alias
- [x] Call rules enforced by an architecture test ([[tools/architecture/rules.ts]]) over the real import graph, with fixtures proving violations fail
- [x] ESLint: typescript-eslint strict + angular-eslint (incl. template accessibility, `OnPush` required)
- [x] Vitest for core (Node, `vitest.core.config.ts`) and components (`ng test`); Playwright for end to end with evidence screenshots in `e2e/evidence/`
- [x] npm scripts: `start`, `build`, `test`, `lint`, `typecheck`, `e2e`, `verify`

Decision: the layer rules are an architecture test instead of `eslint-plugin-boundaries`. Its v7 configuration API changed completely, and a ~100-line checker with its own tests is simpler to trust and to read.
