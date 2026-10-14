---
id: CAD-1
title: Architecture
type: chore
status: done
priority: urgent
---

Create the iDesign architecture of CADence, decomposed by volatility, plus the phased backlog that implements it.

- [x] Volatility analysis: [[Architecture/Volatility analysis]]
- [x] Components and service contracts: [[Architecture]], [[Architecture/Components]]
- [x] Core use cases validated as call chains: [[Architecture/Use cases and call chains]]
- [x] Document model and persistent references: [[Architecture/Document model]]
- [x] Decisions (kernel, solver, desktop, storage, rendering, speed-ups, tests): [[Architecture/Decisions]]
- [x] Conventions and definition of done: [[Conventions]]
- [x] Phased backlog as epics and tasks: [[Roadmap]]
- [x] Evidence: all 10 wiki diagrams parse and render (mermaid 11), all wiki links resolve; published snapshot of the wiki and board
- [x] Self-review: fixed duplicated regeneration workflow in the Assembly Manager ([[Architecture/Decisions#ADR-11]]); reworked the unreadable layer diagram into layers plus a dependency matrix

Decisions confirmed with the user: OCCT + planegcs, Tauri, projects with many documents, one branch per phase with local commits.
