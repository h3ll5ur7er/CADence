---
id: CAD-13
title: Parameter Engine and parameters table
type: feature
status: done
priority: high
---

Variables and expressions with units ([[Architecture/Document model#Parameters]]).

- [x] Expression parser and evaluator: arithmetic, functions, units, references (pulled into [[CAD-8]])
- [x] Dependency ordering; cycle, unknown-name, reserved-name and duplicate errors ([[src/core/engines/parameter/index.ts]])
- [x] Parameters panel in the component editor; expressions accepted in every dimension and feature value
- [x] Parameter changes that would break the model are refused ([[Architecture/Decisions#ADR-17]])
