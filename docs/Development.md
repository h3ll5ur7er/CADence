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
| `npm run build:automation` | The command line and MCP server, `dist/automation/cadence.mjs` (esbuild; packages load from `node_modules`); run it with `npm run cadence -- --help` ([[User-guide/Automation]]) |

Add `?webgl` to the URL to force the WebGL 2 renderer instead of WebGPU. The status bar shows which backend runs.

The geometry kernel (OpenCascade, a 23 MB WebAssembly file) runs in a Web Worker, [[src/workers/geometry.worker.ts]], and loads on the first modeling operation. The build copies the kernel's and the sketch solver's WebAssembly to `/wasm/` (see `assets` in `angular.json`). In unit tests the kernel runs in-process in Node.

The desktop app keeps each project as a folder below the app data folder, `%APPDATA%\dev.cadence.app\projects\<project id>\`:

```
project.json
documents/<document id>.json   design intent, human-readable
assets/<asset id>.bin|.json    imported originals and their metadata
```

## Check

| Command | What it does |
| --- | --- |
| `npm run verify` | Lint, typecheck, all unit tests, the production build and the command line build |
| `npm test` | Core tests in Node (`vitest.core.config.ts`), including the [[Architecture#Call rules|architecture test]], then Angular component tests (`ng test`) |
| `npm run e2e` | Playwright user journeys against the dev server; writes evidence screenshots to `e2e/evidence/` |
| `npm run e2e:desktop` | Smoke test of the built desktop app (Windows; build it first with `npx tauri build --no-bundle --config src-tauri/tauri.test.conf.json`, which turns on WebView2 remote debugging on port 9333): projects as folders, an export through the native save dialog, a restart. It adds a project to the desktop app's folder and deletes it again |
| `npm run e2e:pages` | Builds the web app as GitHub Pages serves it (below `/CADence/`, with the service worker) and runs the journeys in `e2e/pages/` against it: deep links, installability, offline use |
| `npm run build:pages` | Only that build, into `dist/cadence/browser`; the base path comes from `BASE_HREF` (default `/CADence/`). `node tools/pages/serve.mjs` serves it at http://localhost:4310/CADence/ |

## Continuous integration and deployment

[[.github/workflows/ci.yml]] runs on GitHub for every push and pull request:

| Job | What it does |
| --- | --- |
| Lint, types, unit tests, build | `npm run verify` |
| Desktop smoke test (Windows) | Builds the desktop app with remote debugging (`npx tauri build --no-bundle --config src-tauri/tauri.test.conf.json`, Rust cached) and runs `npm run e2e:desktop` on a Windows runner |
| Browser journeys | `npm run e2e`, then `npm run e2e:pages`, in Chromium with software WebGL (the runners have no GPU). Evidence, reports and failure traces are kept as the workflow artifact `journeys` for 14 days |
| Publish on GitHub Pages | On pushes to `master` only, after both jobs passed: `npm run build:pages` for the repository's name, uploaded and deployed to https://h3ll5ur7er.github.io/CADence/ |

> [!IMPORTANT]
> Publishing needs a one-time setting on GitHub: *Settings → Pages → Build and deployment → Source: GitHub Actions*.

The published app keeps working offline once it has been used (see [[Architecture/Decisions#ADR-23]]). The service worker is active only in production builds and never in the desktop app, so `npm start` always serves fresh files. To see what the service worker caches, open the browser's developer tools, *Application → Cache storage*.

## Releases

The version is written in several places (package.json, the desktop app's configuration, Cargo); `node tools/release/version.mjs` prints it and `node tools/release/version.mjs 0.16.0` sets it everywhere, the About dialog's credits included. A test checks that all places agree. Versions follow the phases: `0.<phase>.<fix>`.

To publish the desktop app:

1. Set the version, commit, merge into `master`.
2. Tag the commit and push the tag: `git tag v0.16.0 && git push origin v0.16.0`.
3. [[.github/workflows/release.yml]] builds the installers on Windows (NSIS `.exe` for the current user, `.msi`), signs the update files and publishes a GitHub release with them and `latest.json`. Installed apps find it at their next start.

> [!IMPORTANT]
> Releases need two repository secrets, set once under *Settings → Secrets and variables → Actions*: `TAURI_SIGNING_PRIVATE_KEY`, the contents of the private key whose public key is `plugins.updater.pubkey` in [[src-tauri/tauri.conf.json]], and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty when the key has none). Make a new pair with `npx tauri signer generate -w ~/.tauri/cadence-updater.key` and put its public key into the configuration; installed apps then only accept updates signed with the new key after one more update signed with the old one.

The installers are not code signed yet: Windows SmartScreen warns about them until they are. With a code signing certificate, set `bundle.windows.certificateThumbprint` (or a `signCommand` for cloud signing) in the release configuration [[src-tauri/tauri.release.conf.json]].

Templates: the projects in `public/templates` are made by [[src/automation/templates.ts]]. After changing a template (or what it is made with), write them again with `UPDATE_TEMPLATES=1 npx vitest run -c vitest.core.config.ts src/automation/templates.spec.ts`; the test fails while they differ.

Credits: `node tools/licences/licences.mjs` writes the About dialog's list of libraries ([[src/app/about/credits.ts]]) and the full licence texts (`public/third-party-licences.txt`) from the production dependencies. A test fails when they are out of date, e.g. after a dependency changed.

## Where things go

- New business logic goes in `src/core`, in the component that owns its volatility ([[Architecture/Components]]). The Angular app only renders state and translates gestures into manager calls.
- Each Resource Access implementation must pass its component's contract suite in `testing/`.
- Host-specific client code (Tauri) lives in `src/app/platform/` and is chosen in `app.config.ts`.
- Node-only adapters go in a component's `node.ts`, never in its `index.ts` (which browser code imports). They are typechecked by `tsconfig.automation.json`.
