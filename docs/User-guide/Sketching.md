# Sketching

Sketches are the 2D drawings that parts are built from, and the shapes you send to a laser cutter.

[TOC]

## Start a sketch

1. Open a component (projects open their most recent document).
2. Choose **New sketch** above the viewport and pick a plane: XY (top), XZ (front) or YZ (right).
3. The camera turns to look straight at the plane. Rotation is locked while you sketch; drag with the right or middle mouse button to pan and scroll to zoom.

To change a sketch later, click it in the **Timeline** in the browser panel. **Finish sketch** returns to the 3D view, where finished sketches show as lines with their closed regions lightly shaded.

## Draw

| Tool | Key | How |
| --- | --- | --- |
| Select and drag | S | Click to select, Shift+click to add. Drag a point to move it; everything constrained to it follows. |
| Line | L | Click a start point, then each next point. The line continues from its end; double-click or Esc ends it. Lines drawn within 3° of horizontal or vertical get that relation automatically. |
| Rectangle | R | Click two opposite corners. The sides stay horizontal and vertical. |
| Circle | C | Click the centre, then a point on the circle. |
| Arc | A | Click the centre, the start, then the end, going counter-clockwise. |
| Point | P | Click to place a point. |

Clicking near an existing point (including the **origin**) snaps to it, so the new geometry shares that point. That is the quickest way to anchor a shape at the origin.

Select curves and press **X** to turn them into **construction geometry** (dashed). Construction curves help with constraints but are not part of profiles or exports. **Delete** removes the selection along with the relations on it.

## Constrain and dimension

Select geometry, then pick a relation in the toolbar. Buttons are enabled only when the selection fits:

| Relation | Select |
| --- | --- |
| ● Coincident | two points, or a point and a curve (the point lies on the curve) |
| H / V Horizontal, vertical | a line |
| ∥ Parallel, ⊥ Perpendicular | two lines |
| T Tangent | a line and a circle or arc, or two circles/arcs |
| = Equal | two lines (length) or two circles/arcs (radius) |
| M Midpoint | a point and a line |
| ⚲ Fix | a point |

With the **Dimension** tool (D):

- **Click a line**, then click empty space: its length.
- **Click a circle or arc**: its diameter or radius.
- **Click two points**: their distance. A point and a line: the distance between them. Two lines: the angle.

Type the value and press Enter. Values are expressions with units: `40`, `2 * 20 mm`, `1 in`, `45 deg`, `sqrt(2) * 10`. Plain numbers are millimetres and degrees. Click a dimension's label to change it later.

Small badges show the relations on the geometry; click one and press Delete to remove it.

## Read the status

The toolbar and properties panel show how far the sketch is defined:

- **N degrees of freedom**: some geometry can still move (blue). Add relations or dimensions until it can't.
- **Fully constrained**: nothing can move without changing a dimension (drawn in the text colour).

A change that contradicts existing constraints is refused, and a message names the relations involved. So is a change that would shrink a curve to nothing, such as a line both horizontal and vertical. Undo and redo with Ctrl+Z and Ctrl+Y.

The **properties panel** lists the sketch's closed regions (profiles) and their areas. A circle inside a rectangle gives two profiles: the plate with a hole, and the disc.

## Export for laser cutting

While editing a sketch, **DXF** and **SVG** export it, without construction geometry:

- **DXF**: millimetre units, with lines, circles and arcs as true curves. Works with LightBurn, Inkscape, LibreCAD and laser software in general.
- **SVG**: sized in millimetres, with hairline black strokes and no fill.

The browser downloads the file. The desktop app asks where to save it.
