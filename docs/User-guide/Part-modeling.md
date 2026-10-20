# Part modeling

Turn sketches into solid parts with features. Each feature is a step in the **Timeline**, and every number can be an expression using the component's parameters.

[TOC]

## Units

A component shows and takes lengths in its **unit**: choose millimetres, centimetres or inches under **Units** in the component's properties (the status bar shows it). Dimensions, feature values, sizes, volumes and measures follow it. A plain number typed into a length field is in that unit; it is saved with the unit written out (`2 in`), so changing the unit later never changes the model. Printer and laser profiles stay in millimetres.

## Parameters

Click **Parameters** in the browser panel to name values: `thickness = 6 mm`, `hole = thickness + 2`. Use the names in any dimension or feature value. Changing a parameter updates everything that uses it. A change that would break the model is refused with the reason, and so is a name that is used twice, reserved (units, functions) or part of a cycle.

- **Project parameters**, in the same panel, are shared by every component of the project: a sheet thickness or a screw size. Changing one updates every component that uses it (assemblies too). A component's own parameter of the same name wins.
- **Configurations** are variants of the component: named rows of other values for some parameters (*Short*, *Long*; empty cells keep the parameter's own value). **Shown** picks the variant you see and edit. Exports can use any configuration (**Export → With options…**), and every assembly instance can show its own.
- **Export CSV** and **Import CSV…** move the configuration table to and from a spreadsheet: a row per configuration, a column per parameter, empty cells for the parameter's own value (commas or semicolons). An imported table is checked first: it lists which configurations are new, changed and removed, and every value that does not evaluate, and only **Apply** replaces the table (one undoable step).

## Sheet metal

1. Sketch the flat outline, then **Create → Base flange**. Its **thickness**, **bend radius** (inside) and **K-factor** (where the neutral layer lies, 0.3 to 0.5 for most metals) are the sheet's rules for the whole part, and so is the **corner relief**: where two flanges meet at a corner, a **round** (the size is its diameter) or a **square** (its side) is cut out of the corner, or a **tear** (a cut of the size's length into the sheet, nothing removed). Its size starts at twice the thickness.
2. **Create → Edge flange**: click straight edges of the sheet, or of a flange (a lip on top of a wall). Each gets a bend of the sheet's radius and a straight flange of the given length, bent by the angle (90° by default) towards the side of the face the edge is on: pick a top edge to bend up, a bottom edge to bend down, the outer top edge of a wall to bend outwards.
3. **Create → Hem** folds edges back over the face they are on: **closed** (flat on the sheet), **open** (a **gap** between, a half circle of that diameter) or **teardrop** (a loop of the gap's diameter, bent on until its end comes back down to the sheet). The **length** is the straight piece after the fold.
4. **Create → Miter flange** runs one flange along a chain of connected straight edges of one face, mitred where they meet. Draw its **profile** first: a sketch of straight lines on a plane square to one of the edges (the YZ plane for edges along X, say), starting near the edge. Each line becomes a straight piece as long as the line, after a bend of the sheet's radius by the angle the line turns: up 20 and then over 5 gives a wall with a lip.
5. **Export → Flat pattern (DXF / SVG)** lays the part flat for the laser: each flange is unfolded by the bend allowance, angle × (bend radius + K-factor × thickness), flanges on flanges beyond the flange they stand on, miter flanges with their ends cut to the miter, and the corner reliefs cut. A bend line marks the middle of every bend. Bend lines are on the layer `BEND` in DXF and blue and dashed in SVG, apart from the outlines to cut.

In the 3D model, round and square reliefs are cut straight through the sheet and the bends beside the corner; the flat pattern is the one to cut. A flange stands on one flat piece of the sheet, not across a bend.

## Features

The toolbar above the view has buttons for the everyday features (extrude, revolve, fillet, chamfer, shell, draft, construction plane) and three menus: **Create**, **Pattern** and **Bodies**. A feature opens in the panel on the right; pick what it needs in the view, set the values, press **OK**. If the kernel cannot build it, the reason appears in the panel and nothing changes.

| Feature | Pick in the view | Values |
| --- | --- | --- |
| Extrude | sketch profiles (the latest sketch's are preselected) | distance; along the normal, reversed or symmetric; new body, join, cut or intersect |
| Revolve | profiles on one side of the axis; axis: X/Y/Z, a construction line of the sketch, or an edge | angle (`360 deg` for a full turn) |
| Fillet / Chamfer | edges | radius / distance; a fillet can change its radius along the edge (radius at the other end) |
| Shell | faces to open | wall thickness (inward) |
| Draft | faces to taper; the neutral plane (a plane or a flat face) | angle: the faces lean away from the plane's normal, hinged where they cross it |
| Construction plane | a flat face, or choose a plane; three vertices for *through three points* | offset; or an axis in the base plane and an angle; or a second, parallel plane (midway) |
| **Create →** Loft | one profile in each of two or more sketches, in order | smooth or straight between the sections; operation. Sections are lined up first: each runs the same way round as the one before and starts where it matches it best, so a loft from a round shank into blade sections does not twist |
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
- **For a screw** fills in the diameter of a clearance hole (ISO 273 medium), a tapping hole or a heat-set insert's hole for M2 to M10.
- **Fit for printing** widens the hole so a part fits as designed: *press* by nothing, *snug* by 0.15 mm, *loose* by 0.3 mm, each plus the printer's **hole compensation** (set it under **Check manufacturability** with the other printer values; measure it once by printing a test hole).

A **thread** goes on the wall of a hole or a shaft and starts at its open end. ISO metric coarse sizes M2 to M20 are offered; the hole must be between the thread's minor and major diameter (a 5 mm hole for M6), the shaft about its major diameter. A thread is shown as a helix on the face. **Model the thread** cuts the 60° groove into the body instead: slower, but printable. The groove stops half a groove short of the face's far end, so a thread up to a shoulder (a hex, a flange) is cut too; a thread that would cut nothing is refused.

### Parts

**Create → Part** puts a ready-made part at every point of a sketch (drawn with the **Point** tool), standing on the sketch plane; **On the other side** puts it below. **Turned by** turns it about the point. Like any feature it can make a new body, join, cut or intersect: a cut nut or bearing makes a pocket for it.

| Part | Sizes |
| --- | --- |
| Screw (ISO 4762 socket head), nut (ISO 4032), washer (ISO 7089), heat-set insert | M2 to M10; a screw's length. The head stands on the plane, the shank goes below; an insert goes below the plane. |
| Ball bearing | 623, 625, 608, 688, 6000, 6001, 6200, 6201 |
| Magnet | diameter and height |
| Gear | module, teeth, width, bore, pressure angle, helix angle (0 for a spur gear), end chamfer (the teeth bevelled at 45° at both ends, by that much at the tip; 0 for none). **Meshes with a gear of** shows where the mating gear's point goes (the centre distance, along the sketch's X axis) and how far to turn it so the teeth mesh. The flanks are smooth involute curves with a fillet at the root: four to eight faces per tooth. |
| Ring gear (internal) | module, teeth, width, outside diameter, pressure angle, helix angle; the teeth on the inside, a tooth space along the sketch's X axis. **Meshes with a planet of** shows where the planet's point goes ((ring − planet) × module / 2 along X, no turn), the sun that fits between the planets and how fast the carrier turns; a planet needs at least 10 teeth fewer than the ring. |
| Gear rack | module, teeth, width, height to the pitch line; along the sketch's X axis, teeth towards its Y axis |
| Snap-fit hook | arm length, width, thickness, hook; the hook points along the sketch's Y axis |
| Press-fit peg | diameter, height, fit; made smaller by the fit (and the printer's hole compensation), chamfered at the top |
| Dovetail | width, depth, length, angle, fit; a rail along the sketch's Y axis, or a slot when it cuts (wider by the fit) |
| Living hinge | length, width, depth; a groove across a plate that leaves a thin web to flex: cut it as deep as the plate less about two layers |

All sizes are expressions, so they can use parameters.

## Sketch on a face

Click a flat face of a body, then **New sketch → Selected face**. The sketch moves with the face when the part changes. Construction planes appear in the same menu.

## Timeline

Click a sketch or feature to edit it. The eye button suppresses it (the model is rebuilt without it), and the other buttons rename and delete. A feature that fails after an earlier change turns red; hover it to read why, then edit it, for example to pick an edge again.

- **Roll back:** drag the **rollback marker** (the bar below the last item) up the timeline, or focus it and use the arrow keys. Items below it are greyed out and not built, and new sketches and features are inserted at the marker. Editing a rolled-back item rolls forward to it.
- **Reorder:** drag an item to another place, or focus it and press Alt+↑ or Alt+↓. An item cannot move above something it uses (its sketch, plane or the feature that made the faces it refers to); the reason is shown.
- **Folders:** the folder button next to *Timeline* groups consecutive items (from one item to another) under a name, with a note. A folder opens and closes with its arrow, suppresses all its items at once, rolls the model back to its end, and can be removed (its items stay). An item dragged between a folder's items joins it; one dragged out leaves it.
- **Notes:** the note button of an item says why it is there; the note shows when you hover the item.
- **Repair:** a feature that failed because a face, edge or corner it used is gone (after an earlier change) gets a repair button. It rolls the model back to just before the feature and lists what was lost, where it was, and the nearest faces or edges of the same kind, highlighted in the view. Click a replacement in the view or choose one from the list; **Done** rolls forward again.

Undo and redo with Ctrl+Z and Ctrl+Y.

## Export for printing and CAD

**Export** writes all bodies into one file; **Export → With options…** chooses the bodies and, for meshes, the quality (draft for small files, fine for smooth curves):

- **STEP**: exact geometry, for other CAD programs.
- **STL** and **3MF**: fine triangle meshes in millimetres, for slicers (Cura, PrusaSlicer, Bambu Studio and others).
- **OBJ**: a mesh for other 3D programs.
