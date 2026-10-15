# Part modeling

Turn sketches into solid parts with features. Each feature is a step in the **Timeline**, and every number can be an expression using the component's parameters.

[TOC]

## Parameters

Click **Parameters** in the browser panel to name values: `thickness = 6 mm`, `hole = thickness + 2`. Use the names in any dimension or feature value. Changing a parameter updates everything that uses it. A change that would break the model is refused with the reason, and so is a name that is used twice, reserved (units, functions) or part of a cycle.

## Features

The toolbar above the view has one button per feature. A feature opens in the panel on the right; pick what it needs in the view, set the values, press **OK**. If the kernel cannot build it, the reason appears in the panel and nothing changes.

| Feature | Pick in the view | Values |
| --- | --- | --- |
| Extrude | sketch profiles (the latest sketch's are preselected) | distance; along the normal, reversed or symmetric; new body, join, cut or intersect |
| Revolve | profiles; axis: X/Y/Z, a construction line of the sketch, or an edge | angle (`360 deg` for a full turn) |
| Fillet / Chamfer | edges | radius / distance |
| Shell | faces to open | wall thickness (inward) |
| Construction plane | a flat face, or choose an origin or construction plane | offset |
| Linear / circular pattern | (choose the extrudes or revolves to repeat) | direction or axis, count, spacing or angle |
| Mirror | a flat face, or choose a plane | |

Patterns and mirrors repeat what a feature *did*: a pattern of a cut makes more holes, a pattern of a join more bosses.

## Sketch on a face

Click a flat face of a body, then **New sketch → Selected face**. The sketch moves with the face when the part changes. Construction planes appear in the same menu.

## Timeline

Click a sketch or feature to edit it. The eye button suppresses it (the model is rebuilt without it), and the other buttons rename and delete. A feature that fails after an earlier change turns red; hover it to read why, then edit it, for example to pick an edge again.

Undo and redo with Ctrl+Z and Ctrl+Y.

## Export for printing and CAD

**Export** writes all bodies into one file:

- **STEP**: exact geometry, for other CAD programs.
- **STL** and **3MF**: fine triangle meshes in millimetres, for slicers (Cura, PrusaSlicer, Bambu Studio and others).
- **OBJ**: a mesh for other 3D programs.
