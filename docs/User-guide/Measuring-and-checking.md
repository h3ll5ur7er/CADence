# Measuring and checking

Weigh a part, measure it, and check that your printer or laser cutter can make it. All three work on the live model and update after every change.

[TOC]

## Mass properties

With nothing selected, the panel on the right shows the component. Choose its **Material** (PLA, PETG, plywood, acrylic, aluminium, …) and every body lists:

| Value | Meaning |
| --- | --- |
| Volume | in mm³ |
| Mass | volume × the material's density, in g or kg |
| Surface | total surface area, in mm² |
| Size | the bounding box: width, depth, height in mm |
| Centre of mass | in world coordinates (mm) |

The material is saved with the component and can be undone like any change.

## Measure

Click the ruler in the toolbar (or press **M**), then click faces, edges and corners in the view. Corners light up as the pointer comes near them. Click a picked element again to drop it; **Clear** starts over.

- **One face:** its area, and its radius if it is a cylinder or sphere (with the diameter).
- **One edge:** its length, and its radius if it is a circle or arc.
- **Two picks:** the shortest distance between them, drawn as a line in the view, and the angle between two flat faces, two straight edges, or a straight edge and a flat face.
- **More picks:** the total area of the faces and total length of the edges.

## Check manufacturability

Click the clipboard in the toolbar. Choose a **Machine** from the presets, or change its values. The component then uses your own profile, named *Custom printer* or *Custom laser*. The checks run again after every change.

**3D printers** (build volume, nozzle, layer height, steepest overhang without supports):

| Check | Fails or warns when |
| --- | --- |
| Closed solid | a body is not a closed, valid solid; slicers cannot fill it |
| Build volume | a body is larger than the build volume (a warning if it only fits turned by 90°) |
| Overhangs | faces point down more steeply than the overhang angle (default 45° from vertical); the bottom resting on the bed does not count |
| Wall thickness | walls are thinner than two nozzle lines (warning) or than the nozzle (failure) |

**Laser cutters** (bed, kerf, sheet thickness):

| Check | Fails or warns when |
| --- | --- |
| Sheet thickness | a body is not exactly as thick as the sheet |
| Closed outlines | a sketch has curves that bound no closed region; they cut a line but free no part (fine for engraving) |
| Laser bed | a sketch's outlines do not fit the bed (a warning if they only fit turned by 90°) |
| Kerf compensation | a hole or detail is smaller than the kerf, so the compensated outline would vanish |

Checks that concern particular faces show **Show N faces**. The faces of the selected check are flagged in the view in pink; turn the view (the view cube's *Bottom* face shows overhangs) to find them.

> [!TIP]
> A check that fails points at the geometry, not at the export. Fix the model (a thicker wall, a chamfer under an overhang), and the check updates by itself.

## Export for the laser with kerf compensation

With a laser profile chosen, the sketch toolbar has a third export button, **DXF −kerf**. It writes the sketch with every closed outline moved half a kerf away from the part, so outer contours grow and holes shrink. That way the parts come out at their drawn size. Corners stay sharp, and curves that are not part of an outline (engraving) are not moved. The plain **DXF** and **SVG** buttons still export the exact drawing for laser software that compensates by itself.
