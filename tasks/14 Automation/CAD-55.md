---
id: CAD-55
title: Scripting API and command line
type: feature
status: done
priority: medium
---

- [x] A public, documented API over the managers (projects, documents, features, exports): `Cadence`, `ComponentScript`, `AssemblyScript` in [[src/automation/api.ts]], with shorthand commands for outlines ([[src/automation/shapes.ts]])
- [x] A command line (Node) that runs scripts and converts or exports files without the UI: `projects`, `documents`, `export`, `convert`, `run`, `open-git`, `sync` ([[src/automation/cli.ts]])
- [x] Node composition root and adapters as `node.ts` entry points, enforced by the architecture test
- [x] Tests on real folders with the kernel; browser journey: a part made by a script opens in the app through git (evidence 61)
- [x] Wiki: [[User-guide/Automation]], [[Architecture/Decisions#ADR-31]]
