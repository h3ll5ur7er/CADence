# Importing

Bring in files from other programs and from the internet: 3D models to look at, convert, print or build on, and 2D drawings to cut or to start sketches from.

[TOC]

## Import a file

Click **Import** in the documents panel, or drop files onto it. The original file is kept with the project, unchanged, and appears under **Imported**. Files dropped on the home page (or picked with **Open file…**) start a new project named after the first of them; on the desktop, files opened with CADence do the same.

**Replace the file** (the arrows on an imported document) takes a newer version of it, of the same kind (a 3D file for a 3D file, a drawing for a drawing). Components that insert it regenerate, and assemblies that use it reload; a feature that loses a face or an edge it used shows an error in the timeline.

| Format | What you get |
| --- | --- |
| STEP (`.step`, `.stp`) | Exact solids, as made in CAD programs |
| STL, OBJ, 3MF | Triangle meshes, as used for 3D printing (3MF: every object, with its units and placement) |
| KiCad board (`.kicad_pcb`) | A circuit board with its holes and parts, to design an enclosure around ([[#Circuit boards]]) |
| DXF, SVG | 2D drawings: lines, arcs, circles, ellipses, splines, polylines and paths, text; DXF blocks and hatches |
| PNG, JPEG | Pictures: to draw over in sketches, or to trace into curves ([[User-guide/Sketching#Pictures]]) |
| TTF, OTF, WOFF | Fonts for sketch texts ([[User-guide/Sketching#Text]]) |

## The imported viewer

Opening an imported file shows it in 3D (drawings lie on the XY plane), framed to fit, with what it holds: objects, triangles, volume and the mass in PLA for models; the number of curves for drawings; and the size.

**Export as** converts it: models to STEP, STL, 3MF or OBJ, drawings to DXF or SVG. A mesh converts to STEP as a faceted solid.

Meshes are repaired before they become solids: corners at the same place are merged, repeated triangles removed, triangles turned to face outwards, and openings closed. So an open or broken mesh (a scan, a download) can still be used in a component or an assembly.

### Simplify a large mesh

Meshes with more than 100,000 triangles can be viewed and converted between mesh formats, but not used as solids or saved as STEP as they are. Simplify them under **Simplify** in the properties:

1. Enter how many **Triangles** the mesh should keep (up to 100,000 can become a solid; fewer is faster).
2. **Preview** shows the repaired and simplified mesh in place of the original, with its triangles, volume, and what was repaired (openings closed, triangles turned, duplicates removed).
3. **Keep as new file** adds it to the project as "<name> (simplified)", in the original's format, and opens it. Use that one with Insert body or in assemblies; the original stays as it is.

Simplifying keeps the shape where it matters: flat and gently curved areas lose triangles first, and the edges of openings stay where they are.

## Use a model in a component

Choose **Insert body** in the component toolbar and pick the imported file. Its solids become bodies of the component: sketch on their faces, cut holes into them, round their edges, or join new features to them. The feature updates when the timeline regenerates, as long as the imported file stays in the project.

## Use a model in an assembly

Imported 3D files appear in the assembly's **Insert** menu next to the project's components. Joints attach to their faces and edges like to any part.

## Circuit boards

Import a KiCad board (`.kicad_pcb`, KiCad 6 and newer) to design an enclosure around it. The viewer shows the board with its parts, its thickness, its holes, its mounting holes and how many parts it has.

- **The board** is its outline on the Edge.Cuts layer, as thick as the board, with its drilled holes (round and oval) and cut-outs. Its lower left corner is at the origin and its bottom on the XY plane. Copper, tracks and vias are left out.
- **The parts** are one more body: each part is a box of its courtyard, as tall as its **Height** field in KiCad (for example `11.6 mm`), or 3 mm without one, on the side the part is on. Mounting holes are no parts.
- **STEP models:** import the STEP files of the parts' 3D models into the same project, named like the model in KiCad (`SOIC-8_3.9x4.9mm_P1.27mm.step` for `…/SOIC-8_3.9x4.9mm_P1.27mm.wrl`), and those parts are their models, placed as in KiCad's 3D viewer. Import them before you open the assembly that uses the board, or open it again.
- **Holes for joints:** each hole's wall is named after its part: `hole:H1` for a part H1 with one hole (a mounting hole), `hole:J1:2` for pad 2 of J1. Insert the board into an assembly, and attach the enclosure's screw posts to the holes with joints: a joint on a hole lines up with its axis. The board's faces are `board:top` and `board:bottom`.

## Use a drawing in a sketch

While editing a sketch, **Insert drawing** in the sketch toolbar adds an imported DXF or SVG file. Choose how under **Insert as**, then pick the file:

| Insert as | What you get |
| --- | --- |
| One piece, keeping its proportions | The whole drawing, in the colour of generated geometry, with two **handles** (ringed points) at its bottom corners. Drag the handles, or dimension and constrain them, to move, turn and scale the drawing; it always keeps its proportions. Moving any of its curves with the Move or Rotate tool moves the whole drawing; deleting one deletes it. |
| Curves with the relations they show | Separate curves you can edit. Lines that are horizontal or vertical get that relation, and lines and arcs that meet smoothly stay tangent. |
| Curves, free | Separate curves with no relations. |
| Curves, fixed | Separate curves, every point fixed where it is. |

- Lines, circles, arcs, ellipses and SVG Bézier curves stay exact. Splines and other curves become as few lines and arcs as stay within 0.01 mm of the original.
- DXF blocks (`INSERT`, also scaled, turned, nested and arrayed) and hatch boundaries are drawn as curves.
- Text (SVG `<text>`, DXF `TEXT` and `MTEXT`) becomes sketch text in the bundled Inter font, which you can edit like any text in a sketch ([[User guide/Sketching#Text]]). The original font is not kept.
- Ends that meet are joined, so closed outlines become profiles you can extrude.
- SVG drawings are placed with the bottom left of their page at the origin, in the sizes the file gives (millimetres, inches, or 96 pixels per inch). DXF drawings keep their coordinates and units.

When you extrude, the outer outline is selected and the profiles that fill its holes are not, so a plate keeps its holes.
