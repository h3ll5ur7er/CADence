# Measuring and checking

Weigh a part, measure it, check that your printer or laser cutter can make it, and check that it is strong enough. They work on the live model.

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

**A body of another material:** each body has a **Material** of its own under its values, *As the component* until you choose one, say a steel shaft in a PLA housing. Its mass, the strength check, the bill of materials of assemblies and parts lists of drawings (which name every material of a part: *PLA, Steel*) and 3MF and OBJ exports use it. Choosing *As the component* again makes it follow the component's material.

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
| Wall thickness | walls are thinner than two nozzle lines (warning) or than the nozzle (failure); measured straight into the material from every face, to where it leaves through a face within 40° of square, so an edge where two faces meet at more than 40° (the end of a 45° helical tooth) is no thin wall |

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

## Check strength

Will the bracket hold? Click the bent beam in the toolbar (**Check strength**). It calculates how a part bends and how much stress builds up in it under loads, for the component's **Material**.

1. With **Hold fixed** chosen, click the faces that are held: screwed down, glued, clamped. Click a face again to release it.
2. Choose **Load** and click the faces that are pushed or pulled. Each load starts as 100 N into its face. Change it to:
   - a **Force** in N, spread over the face, into the face or along an axis (down is −Z);
   - a **Pressure** in MPa (N/mm²), pushing on the face wherever it faces.
3. Click **Run**. A few seconds later the panel shows:

| Value | Meaning |
| --- | --- |
| Largest stress | the highest von Mises stress, in MPa |
| Largest deflection | how far the part moves at most, in mm |
| Safety factor | the material's yield strength over the largest stress: below 1 it bends for good or breaks, below 2 it is close |
| Elements | how many pieces the part was split into |

The part is coloured by stress, from blue (none) to red (the largest), and drawn bent, exaggerated so you can see how. Untick **Show the bent shape** to see it straight. **Element size** (mm) makes the calculation finer or coarser; it is chosen from the part's size when left empty. Smaller elements take longer.

The fixed faces and loads are saved with the component; run the check again after a change.

> [!WARNING]
> This is a quick check, not an engineering approval. It is linear and static and uses the solid material's stiffness and strength. 3D-printed parts are weaker, above all across their layers, and sharp inside corners show more stress than they really carry. Treat safety factors below 2 with care.

Bodies are checked one by one: a body needs a fixed face of its own, and bodies do not hold each other up. Each body is checked in its own material, and the safety factor is the smallest of the bodies'. Each material in the list knows its stiffness (Young's modulus), Poisson's ratio and yield strength.

## Export for the laser with kerf compensation

With a laser profile chosen, the sketch toolbar has a third export button, **DXF −kerf**. It writes the sketch with every closed outline moved half a kerf away from the part, so outer contours grow and holes shrink. That way the parts come out at their drawn size. Corners stay sharp, and curves that are not part of an outline (engraving) are not moved. The plain **DXF** and **SVG** buttons still export the exact drawing for laser software that compensates by itself.
