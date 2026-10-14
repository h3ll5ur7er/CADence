---
id: CAD-8
title: Sketch Engine with planegcs
type: feature
status: todo
priority: high
---

Solve sketches with planegcs ([[Architecture/Decisions#ADR-3]]): geometry, degrees of freedom, constraint status and conflicting constraints.

- [ ] Load the planegcs WASM in the browser and in Node tests
- [ ] Map sketch entities and constraints to planegcs; constraint values come from evaluated expressions
- [ ] DOF and status (under / fully / over-constrained / conflicting) with conflict ids
- [ ] Tests for each constraint type
