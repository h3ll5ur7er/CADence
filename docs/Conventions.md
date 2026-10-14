# Conventions

How we write, test and ship CADence.

[TOC]

## Code

- **Principles:** KISS, SOLID, YAGNI. Stay DRY for knowledge (one place per rule) but WET for incidental similarity: don't couple components just because two snippets look alike.
- **TypeScript strict** everywhere (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). No `any` in `src/core`.
- **Layers** follow [[Architecture#Call rules]], enforced by the architecture test in `tools/architecture`. Each component folder exports its contract and factory from `index.ts`, and everything else is private.
- **Angular:** standalone components, zoneless, signals, `OnPush`, `inject()` instead of constructor injection, built-in control flow, one component per file, and component selectors prefixed `cad-`.
- **Naming:** components are named by role (`DesignManager`, `SketchEngine`, `DocumentAccess`). Resource Access verbs are business verbs (`establish`, `discard`), not `insert`/`delete`.
- **Errors:** expected failures (invalid expression, unsolvable sketch, failed boolean) are typed results, not exceptions. Exceptions are reserved for defects.

## Testing

- **TDD:** write the failing test first for engine rules, manager workflows and access contracts.
- `npm test` runs Vitest (core and components). `npm run e2e` runs Playwright against the dev build.
- Geometry tests assert on measurable properties (volume, area, bounding box, face count), not on mesh bytes.

## Git

- One branch per task or phase: `feature/CAD-<n>-<slug>`, cut from `master`. Commits are local only. The user reviews, merges and pushes.
- Commit messages start with the task id: `CAD-12: Add extrude feature`.
- Wiki and task changes are committed together with the code they describe.

## Definition of done

A phase or task is done only when all of the following hold:

1. **Self-review** of the diff, with the issues found fixed.
2. **Checks pass** (`npm run verify` = lint, typecheck, unit tests, production build; plus `npm run e2e`), and new behavior has tests.
3. **Tasks updated:** checklist ticked, status moved; follow-ups captured as new tasks.
4. **Wiki updated** where the work changed facts, decisions or how-tos.
5. **Visible evidence:** screenshots or a recording from the Playwright run (`e2e/evidence/`), and from the Foundation phase on a running demo (`npm start`) where the claims can be tried.
