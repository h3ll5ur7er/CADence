# Development

How to run, test and build CADence. The rules for code and the definition of done are in [[Conventions]].

[TOC]

## Prerequisites

- Node 24 and npm 11
- For the desktop app: Rust (stable, MSVC toolchain on Windows) and the WebView2 runtime, which ships with Windows 11
- Once: `npm install` and `npx playwright install chromium`

## Run

| Command | What it does |
| --- | --- |
| `npm start` | Web app at http://localhost:4200, with projects in this browser's IndexedDB |
| `npm run desktop` | Desktop app (Tauri) in development mode; starts `npm start` itself, so stop any running dev server first |
| `npm run desktop:build` | Release build of the desktop app with installers in `src-tauri/target/release/bundle/` (`npx tauri build --no-bundle` builds only the executable) |

Add `?webgl` to the URL to force the WebGL 2 renderer instead of WebGPU. The status bar shows which backend runs.

The desktop app keeps each project as a folder below the app data folder, `%APPDATA%\dev.cadence.app\projects\<project id>\`:

```
project.json
documents/<document id>.json   design intent, human-readable
assets/<asset id>.bin|.json    imported originals and their metadata
```

## Check

| Command | What it does |
| --- | --- |
| `npm run verify` | Lint, typecheck, all unit tests and the production build |
| `npm test` | Core tests in Node (`vitest.core.config.ts`), including the [[Architecture#Call rules|architecture test]], then Angular component tests (`ng test`) |
| `npm run e2e` | Playwright user journeys against the dev server; writes evidence screenshots to `e2e/evidence/` |

## Where things go

- New business logic goes in `src/core`, in the component that owns its volatility ([[Architecture/Components]]). The Angular app only renders state and translates gestures into manager calls.
- Each Resource Access implementation must pass its component's contract suite in `testing/`.
- Host-specific client code (Tauri) lives in `src/app/platform/` and is chosen in `app.config.ts`.
