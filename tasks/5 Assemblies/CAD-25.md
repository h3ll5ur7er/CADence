---
id: CAD-25
title: Interference check and assembly export
type: feature
status: done
priority: medium
---

- [x] Interference detection between instances (OCCT common of overlapping pairs; touching is not interference)
- [x] Export assemblies as STEP (one named solid per instance) and STL/3MF/OBJ (3MF: one object per instance; STL: all parts in one file)
- [x] Evidence: `e2e/evidence/23-assembly-interference.png`, `linkage.step`

Not done: a STEP product tree with sub-assemblies; CADence assemblies have one level, so every instance is a top-level product.
