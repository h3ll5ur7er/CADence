---
id: CAD-13
title: Parameter Engine and parameters table
type: feature
status: todo
priority: high
---

Variables and expressions with units ([[Architecture/Document model#Parameters]]).

- [ ] Expression parser and evaluator: arithmetic, functions, units, references
- [ ] Dependency ordering; cycle and unit-mismatch errors
- [ ] Parameters table in the component editor; expressions accepted in every numeric input

Already done in [[CAD-8]]: the expression evaluator (arithmetic, functions, units, names from a scope) in [[src/core/engines/parameter/expression.ts]]. What remains here is the parameters table and evaluating parameters in dependency order.
