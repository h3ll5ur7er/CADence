---
id: CAD-4
title: Project and Document Access for the browser
type: feature
status: done
priority: high
---

IndexedDB implementations of the Resource Access contracts, plus in-memory fakes for manager tests ([[Architecture/Decisions#ADR-5]]).

- [x] Contract test suites (`testing/*.contract.ts`) run against every implementation
- [x] Project Access: enumerate, find, establish, revise, discard
- [x] Document Access: enumerate, load (migrates the schema on read), store, discard
- [x] Schema migration pipeline with tests
- [x] In-memory implementations
- [ ] ~~Asset Access~~: moved to [[CAD-26]], the first feature that stores blobs (YAGNI)

Each access component owns its own IndexedDB database (`cadence-projects`, `cadence-documents`), so components share no storage internals.
