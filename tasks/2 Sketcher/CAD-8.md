---
id: CAD-8
title: Sketch Engine with planegcs
type: feature
status: done
priority: high
---

Solve sketches with planegcs ([[Architecture/Decisions#ADR-3]]): geometry, degrees of freedom, constraint status and conflicting constraints.

- [x] Load the planegcs WASM in the browser (lazily, from `/wasm/`) and in Node tests ([[Architecture/Decisions#ADR-14]])
- [x] Map sketch entities and constraints to planegcs; dimension values come from evaluated expressions ([[src/core/engines/sketch/planegcs-solver.ts]])
- [x] DOF and status (under / fully / over-constrained / failed) with conflict ids
- [x] Interactive drags through temporary constraints
- [x] Tests for every constraint and dimension kind ([[src/core/engines/sketch/sketch-engine.spec.ts]])

The expression evaluator of the Parameter Engine was pulled forward from [[CAD-13]], because dimensions are expressions.
