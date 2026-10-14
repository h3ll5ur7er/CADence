---
id: CAD-3
title: Core contracts and utilities
type: feature
status: done
priority: high
---

Data contracts from [[Architecture/Document model]] (projects, documents, events) and the utilities from [[Architecture/Components#Utilities]].

- [x] Contracts: branded ids, Project, DocumentSummary, component/assembly/imported documents, domain events, Result type
- [x] Identity: id generation, stable stringify, content hashing
- [x] Messaging: typed event bus with queued delivery (worker RPC follows in [[CAD-12]])
- [x] Diagnostics: logger and performance measures
- [x] Clock: injectable time source for testable workflows
- [x] IndexedDB: minimal promise wrapper used by the browser Resource Access
- [ ] ~~Math and Units~~: deferred until the sketcher needs it (YAGNI)
