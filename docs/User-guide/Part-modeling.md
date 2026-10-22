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
| **Create →** Sweep | profiles; the path is the curves of another sketch, a helix, or a path in space, starting at the profile | operation |
| **Create →** Path in space | points, x, y, z a line (mm or expressions) | straight between them or smooth through them: a path for sweeps that leave one plane, such as a cable through a part. It makes no body. Agents can also give points of sketches and the directions it leaves and arrives |
| **Create →** Hole | (choose the sketch with the hole points) | simple, counterbored or countersunk; diameter; through all or to a depth, with a drill point; teardrop and bridge layer for printing |
| **Create →** Rib | (choose the sketch with an open line or curve) | thickness; to a depth or up to the next face; direction |
| **Create →** Wrap | profiles (letters, a scale, a logo), then **Pick the face** and click it | wrapped round or projected; depth; emboss or engrave |
| **Create →** Helix | a plane (or a flat face) | diameter, pitch, turns or height, taper, left-handed: a helix about the plane's normal through its origin, starting on its X axis. It makes no body: sweep a profile along it (a coil, a thread of any shape) |
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
- **Drill point** ends a hole that goes to a depth in the cone a twist drill leaves, 118° unless you set another **point angle**. The depth is to the full diameter, as drawings give it; the point goes below it.

A **rib** thickens the open lines of its sketch and extrudes them along the sketch's normal, reversed or both ways. **Up to the next face** runs it until it meets the part, whatever the shape of the face it meets: sketch the rib on the inside of one wall and it fills the gap to the opposite wall. A rib that meets nothing in its direction says so.

A **thread** goes on the wall of a hole or a shaft and starts at its open end. ISO metric coarse sizes M2 to M20 are offered; the hole must be between the thread's minor and major diameter (a 5 mm hole for M6), the shaft about its major diameter. A thread is shown as a helix on the face. **Model the thread** cuts the 60° groove into the body instead: slower, but printable. The groove stops half a groove short of the face's far end, so a thread up to a shoulder (a hex, a flange) is cut too; a thread that would cut nothing is refused.

### Wrap: emboss and engrave on round faces

**Create → Wrap** puts the profiles of a sketch onto a face of a body and raises them out of it (**emboss**) or cuts them into it (**engrave**) by the depth, along the face's normal:

- **Wrapped round** rolls the sketch onto a cylinder or a cone, so lengths along the surface stay as drawn: a 5 mm step of a scale is 5 mm round the knob. Draw the sketch on a plane along the axis (for a part standing on XY, the XZ or YZ plane, or a construction plane at an angle); the sketch touches the face on the side its plane is on, and its x direction runs round the face. For exact lengths on a cone, use a plane that touches it along a line.
- **Projected along the sketch's normal** casts the profiles straight onto any face (a dome, a curved lid), seen from the sketch's front; only the side of the face nearest it is marked.

Text works like any profile: sketch the letters with the Text tool and pick them all. A wrap reaches at most once round the face.

### Parts

**Create → Part** puts a ready-made part at every point of a sketch (drawn with the **Point** tool), standing on the sketch plane; **On the other side** puts it below. **Turned by** turns it about the point. Like any feature it can make a new body, join, cut or intersect: a cut nut or bearing makes a pocket for it.

| Part | Sizes |
| --- | --- |
| Screw (ISO 4762 socket head), nut (ISO 4032), washer (ISO 7089), heat-set insert | M2 to M10; a screw's length. The head stands on the plane, the shank goes below; an insert goes below the plane. |
| Ball bearing | 623, 625, 608, 688, 6000, 6001, 6200, 6201 |
| Magnet | diameter and height |
| Gear | module, teeth, width, bore, pressure angle, helix angle (0 for a spur gear), end chamfer (the teeth bevelled at 45° at both ends, by that much at the tip; 0 for none). **Meshes with a gear of** shows where the mating gear's point goes (the centre distance, along the sketch's X axis) and how far to turn it so the teeth mesh. The flanks are smooth involute curves with a fillet at the root: four to eight faces per tooth. **Profile shift** (× module) moves the teeth out and thickens them at the root: a gear of fewer than 17 teeth needs at least 1 − z · sin²(pressure angle) / 2 to keep its whole involute (the dialog says how much; 8 teeth need 0.54). With the mate's shift, the centre distance is the one at which shifted gears mesh without play. |
| Ring gear (internal) | module, teeth, width, outside diameter, pressure angle, helix angle; the teeth on the inside, a tooth space along the sketch's X axis. **Meshes with a planet of** shows where the planet's point goes ((ring − planet) × module / 2 along X, no turn), the sun that fits between the planets and how fast the carrier turns; a planet needs at least 10 teeth fewer than the ring. The roots of its teeth are filleted, clear of the planets' tips. |
| Bevel gear | module, teeth, teeth of the mate, shaft angle (90° by default), face width (along the cone, at most a third of it), bore, pressure angle; the large end on the sketch plane, the teeth narrowing towards the apex of the pitch cone, a tooth along X. The dialog says where the apex is and where the mate goes: its large end centred so far along X and up, its axis towards the apex at the shaft angle, turned so its teeth fall between this gear's. For 90°: a construction plane parallel to YZ at that X, the mate on its other side. |
| Worm | module, starts, lead angle, length, bore, pressure angle; centred on the point along the sketch's normal, a thread crossing the sketch plane on its X axis. Its pitch diameter is starts × module / tan(lead angle). **Drives a wheel of** shows where the wheel's middle goes: so far along X on the sketch plane, its axis along Y. |
| Worm wheel | module, teeth, the worm's starts and lead angle, width, bore, pressure angle; helical teeth at the lead angle (it touches the worm at points: not hollowed to it), a tooth space facing −X halfway up. The dialog says where the worm's point goes: along −X, half the width up, in a sketch on the plane through the wheel's axis and X (XZ for a wheel on XY). |
| Gear rack | module, teeth, width, height to the pitch line; along the sketch's X axis, teeth towards its Y axis |
| Compression spring | wire, outside diameter, pitch, turns (in all), ends: open, closed (the end turns ease down to lie flat) or closed and ground (flat at both ends); standing on the sketch plane. The dialog gives the free and solid lengths; the component's properties give the **spring rate** from the material. |
| Extension spring | wire, outside diameter, turns; coils a wire apart and a loop bent up from the last coil at each end; its length inside the hooks and its rate in the properties |
| Torsion spring | wire, outside diameter, pitch, turns, legs; a straight leg going on from each end of the coil; its rate in N·mm per degree in the properties |
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
- **Folders in folders:** a folder may hold other folders whole, never part of one; each level is indented further. Closing a folder hides the folders in it too. Drag a folder (or focus it and press Alt+↑ or Alt+↓) to move it with everything in it; dropped between another folder's items, it goes into that folder.
- **Notes:** the note button of an item says why it is there; the note shows when you hover the item.
- **Repair:** a feature that failed because a face, edge or corner it used is gone (after an earlier change) gets a repair button. It rolls the model back to just before the feature and lists what was lost, where it was, and the faces or edges most like it, highlighted in the view: those of the same shape first (the same kind of surface or curve, the same size and radius, marked *same-shaped*), then the nearest. So a fillet whose hole moved finds that hole's edge, not the edge of the smaller hole next to where it was. Click a replacement in the view or choose one from the list; **Done** rolls forward again.

Undo and redo with Ctrl+Z and Ctrl+Y.

## Export for printing and CAD

**Export** writes all bodies into one file; **Export → With options…** chooses the bodies and, for meshes, the quality (draft for small files, fine for smooth curves):

- **STEP**: exact geometry, for other CAD programs.
- **STL** and **3MF**: fine triangle meshes in millimetres, for slicers (Cura, PrusaSlicer, Bambu Studio and others).
- **OBJ**: a mesh for other 3D programs.
