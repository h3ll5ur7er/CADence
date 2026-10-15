---
id: CAD-46
title: Body operations
type: feature
status: done
priority: medium
---

- [x] Combine existing bodies: join, cut, intersect (keep the tools or use them up)
- [x] Split a body by a plane or face
- [x] Move or copy a body (turn about an axis, then shift)
- [x] Scale a body uniformly

Scaling per axis is left out: it needs `BRepBuilderAPI_GTransform`, which the bundled OpenCascade build (replicad-opencascadejs) does not include. Listed in [[Open points]].
