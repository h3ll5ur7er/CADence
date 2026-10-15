---
id: CAD-23
title: Joints and Kinematics Engine
type: feature
status: done
priority: high
---

Kinematics Engine ([[src/core/engines/kinematics/index.ts]], [[Architecture/Decisions#ADR-20]]) and joint frames from geometry ([[Architecture/Decisions#ADR-21]]).

- [x] Joint origins on topology references (flat faces, holes and shafts, circular and straight edges)
- [x] Rigid, revolute, slider, cylindrical, pin-slot, planar and ball joints with limits
- [x] Kinematics Engine solve: spanning tree plus Levenberg–Marquardt for closed loops (four-bar linkage tested)
- [x] Drag to move along free DOF: a slider per degree of freedom, previewed live and saved on release

Not done: dragging parts directly in the 3D view along their free directions.
