---
id: CAD-98
title: Internal (ring) gears in the gear generator
type: feature
status: done
priority: medium
labels: [parts, gears, found-by-CAD-96]
---

The gear generator ([[src/core/contracts/parts.ts]]) makes external spur and helical gears and racks, but no internal gear, so a planetary gear set (sun, planets, ring) cannot be modelled: the radial engine's propeller reduction in [[CAD-96]] needs one. Cutting an external gear out of a ring is not a substitute: the tooth spaces of an internal gear are not the teeth of an external one (tip and root clearances and the involute run the other way).

- [x] A `ring-gear` part (module, teeth, width, outside diameter, pressure angle, helix angle), involute teeth on the inside
- [x] Matching pairs: the centre distance `m·(z_ring − z_planet)/2`, and a check that the planet fits (no interference for too few teeth difference)
- [x] Motion link for a planetary set: the ratio of the carrier, and of the planets on it, from the teeth (documented in [[User guide/Assemblies#Motion links]])

**Done (phase 26).** `ring-gear` parts ([[src/core/engines/modeling/gears.ts]]): the tooth spaces are an external gear's teeth, from the ring's tip circle (pitch − m) to its root circle (pitch + 1.25 m). The feature dialog shows where a planet goes and refuses planets with fewer than 10 teeth less than the ring (`ringGearMesh`). Motion links *Sun to planet carrier* and *Sun to planet* take their ratios from the sun's and ring's teeth (`planetaryRatios`; 24 and 60 give 2/7 and −20/21). The ring's root corners have no fillet.
