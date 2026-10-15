# Part modeling

Turn sketches into solid parts with features. Each feature is a step in the **Timeline**, and every number can be an expression using the component's parameters.

[TOC]

## Parameters

Click **Parameters** in the browser panel to name values: `thickness = 6 mm`, `hole = thickness + 2`. Use the names in any dimension or feature value. Changing a parameter updates everything that uses it. A change that would break the model is refused with the reason, and so is a name that is used twice, reserved (units, functions) or part of a cycle.

## Features

The toolbar above the view has buttons for the everyday features (extrude, revolve, fillet, chamfer, shell, draft, construction plane) and three menus: **Create**, **Pattern** and **Bodies**. A feature opens in the panel on the right; pick what it needs in the view, set the values, press **OK**. If the kernel cannot build it, the reason appears in the panel and nothing changes.

| Feature | Pick in the view | Values |
| --- | --- | --- |
| Extrude | sketch profiles (the latest sketch's are preselected) | distance; along the normal, reversed or symmetric; new body, join, cut or intersect |
| Revolve | profiles; axis: X/Y/Z, a construction line of the sketch, or an edge | angle (`360 deg` for a full turn) |
| Fillet / Chamfer | edges | radius / distance; a fillet can change its radius along the edge (radius at the other end) |
| Shell | faces to open | wall thickness (inward) |
| Draft | faces to taper; the neutral plane (a plane or a flat face) | angle: the faces lean away from the plane's normal, hinged where they cross it |
| Construction plane | a flat face, or choose a plane; three vertices for *through three points* | offset; or an axis in the base plane and an angle; or a second, parallel plane (midway) |
| **Create →** Loft | one profile in each of two or more sketches, in order | smooth or straight between the sections; operation |
| **Create →** Sweep | profiles; the path is the curves of another sketch, starting at the profile | operation |
| **Create →** Hole | (choose the sketch with the hole points) | simple, counterbored or countersunk; diameter; through all or to a depth; teardrop and bridge layer for printing |
| **Create →** Rib | (choose the sketch with an open line or curve) | thickness, depth, direction |
| **Create →** Thread | the wall of a hole or a shaft | ISO metric size; length; shown or modelled; start at the other end |
| **Create →** Insert body | (choose an imported 3D file) | |
| **Pattern →** Linear / circular / along a path | (choose the features to repeat) | direction, axis or path (a sketch); count; spacing, angle, or turning with the path |
| **Pattern →** Mirror | a flat face, or choose a plane | |
| **Bodies →** Combine | the bodies to combine with a target | join, cut or intersect; keep the other bodies or use them up |
| **Bodies →** Split | a body; a plane or a flat face | the piece behind the plane becomes a new body |
| **Bodies →** Move or copy | bodies (click them, or tick them) | X, Y, Z shift; turn about an axis by an angle; copy |
| **Bodies →** Scale | bodies | factor, about the origin, the same in every direction |

Patterns and mirrors repeat what a feature *did*: a pattern of a cut makes more holes, a pattern of a join more bosses. Holes and ribs can be repeated too.

### Holes and threads

Draw the hole centres with the **Point** tool in a sketch on the face, then **Create → Hole**: every point of the sketch that no curve uses gets a hole, going into the material below the sketch. For 3D printing:

- **Teardrop** gives holes that lie on their side a pointed top, so they print without support.
- **Bridge layer** leaves one printer layer (the profile's layer height) over a counterbored hole, so the counterbore's floor prints as a bridge; drill it out after printing.

A **thread** goes on the wall of a hole or a shaft and starts at its open end. ISO metric coarse sizes M2 to M20 are offered; the hole must be between the thread's minor and major diameter (a 5 mm hole for M6), the shaft about its major diameter. A thread is shown as a helix on the face. **Model the thread** cuts the 60° groove into the body instead: slower, but printable.

## Sketch on a face

Click a flat face of a body, then **New sketch → Selected face**. The sketch moves with the face when the part changes. Construction planes appear in the same menu.

## Timeline

Click a sketch or feature to edit it. The eye button suppresses it (the model is rebuilt without it), and the other buttons rename and delete. A feature that fails after an earlier change turns red; hover it to read why, then edit it, for example to pick an edge again.

- **Roll back:** drag the **rollback marker** (the bar below the last item) up the timeline, or focus it and use the arrow keys. Items below it are greyed out and not built, and new sketches and features are inserted at the marker. Editing a rolled-back item rolls forward to it.
- **Reorder:** drag an item to another place, or focus it and press Alt+↑ or Alt+↓. An item cannot move above something it uses (its sketch, plane or the feature that made the faces it refers to); the reason is shown.

Undo and redo with Ctrl+Z and Ctrl+Y.

## Export for printing and CAD

**Export** writes all bodies into one file; **Export → With options…** chooses the bodies and, for meshes, the quality (draft for small files, fine for smooth curves):

- **STEP**: exact geometry, for other CAD programs.
- **STL** and **3MF**: fine triangle meshes in millimetres, for slicers (Cura, PrusaSlicer, Bambu Studio and others).
- **OBJ**: a mesh for other 3D programs.
