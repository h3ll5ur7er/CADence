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
| DXF, SVG | 2D drawings: lines, arcs, circles, ellipses, splines, polylines and paths, text; DXF blocks and hatches |
| PNG, JPEG | Pictures: to draw over in sketches, or to trace into curves ([[User-guide/Sketching#Pictures]]) |
| TTF, OTF, WOFF | Fonts for sketch texts ([[User-guide/Sketching#Text]]) |

## The imported viewer

Opening an imported file shows it in 3D (drawings lie on the XY plane), framed to fit, with what it holds: objects, triangles, volume and the mass in PLA for models; the number of curves for drawings; and the size.

**Export as** converts it: models to STEP, STL, 3MF or OBJ, drawings to DXF or SVG. A mesh converts to STEP as a faceted solid.

> [!NOTE]
> Meshes with more than 100,000 triangles can be viewed and converted between mesh formats, but not used as solids or saved as STEP. Simplify them in your slicer or mesh editor first.

## Use a model in a component

Choose **Insert body** in the component toolbar and pick the imported file. Its solids become bodies of the component: sketch on their faces, cut holes into them, round their edges, or join new features to them. The feature updates when the timeline regenerates, as long as the imported file stays in the project.

## Use a model in an assembly

Imported 3D files appear in the assembly's **Insert** menu next to the project's components. Joints attach to their faces and edges like to any part.

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
