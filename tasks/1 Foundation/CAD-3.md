---
id: CAD-3
title: Core contracts and utilities
type: feature
status: todo
priority: high
---

Data contracts from [[Architecture/Document model]] (projects, documents, commands, events) and the utilities from [[Architecture/Components#Utilities]].

- [ ] Contracts: ids, Project, DocumentSummary, component/assembly/imported documents, Result type
- [ ] Identity: id generation, content hashing
- [ ] Messaging: typed event bus for queued manager events (worker RPC follows in [[CAD-12]])
- [ ] Diagnostics: logger and performance marks
- [ ] Math and Units: vectors, matrices, unit conversion, only as far as needed (YAGNI)
