---
id: CAD-33
title: End-to-end journeys for every feature
type: chore
status: done
priority: medium
---

Click through the features that so far are tested only in the engine.

- [x] Revolve
- [x] Shell
- [x] Chamfer
- [x] Construction planes (offset)
- [x] Circular pattern
- [x] Mirror

Journeys in [[e2e/features.spec.ts]]. Found on the way: the second and further bodies of a pattern showed their id instead of a name; they are now named "Circular pattern 1 (2)" and so on ([[src/app/editor/modeling/body-names.ts]]).
