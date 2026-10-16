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

More shapes are in the **Shapes** menu (▾ next to the drawing tools):

| Shape | How |
| --- | --- |
| Centre rectangle | Click the centre, then a corner. A construction diagonal keeps it centred. |
| Three-point arc | Click the start, the end, then a point the arc passes through. |
| Slot | Click the centres of both ends, then how wide it is. The ends stay tangent to the sides and equal. |
| Polygon | Set the number of sides in the toolbar, click the centre, then a corner. The corners sit on a construction circle and the sides stay equal. |
| Ellipse | Click the centre, the end of the long axis, then how wide it is. A radius dimension on an ellipse sets its short half axis. |
| Spline | Click each point the curve passes through; double-click to end. Click the first point again to close it. Move its points to reshape it. |
| Text | Type the text and its height in the toolbar (tick Bold if you like), then click where its baseline starts (see [Text](#text)). |
| Project | Click edges or faces of bodies in the view (see [Projected geometry](#projected-geometry)). |

### Text

The **Text** tool places text as outlines of the bundled Inter font. The height is the height of capital letters in millimetres; the point you click is the start of the baseline. Each letter becomes a profile (and its holes, such as the inside of an A, profiles of their own), so text extrudes, cuts and exports like any curve: sketch on a face of a body and extrude the letters to emboss them, or cut them to engrave them. When you extrude, the letters are selected and their holes are not.

Select a text to change it in the panel on the right: the text, its height, its angle and whether it is bold. Move it by its point, or constrain and dimension that point like any other. Text can be construction geometry too.

**Fonts.** Besides the built-in Inter, a text can use any TrueType, OpenType or WOFF font: import the font file into the project (it then shows its letters in the documents panel), choose **A Google Font…** and type a family such as *Roboto Slab* (downloaded once and kept in the project), or, in the desktop app, **A font on this computer…**. The font travels with the project, in archives and through sync.

**Along a curve.** Choose a line, arc, circle or spline of the sketch under **Along**: the text follows it from **Start along it** millimetres on, letters standing on its left; **Other side** turns the text round to stand on the other side and read the other way (for a circle: outside it, clockwise).

### Snapping

While drawing, a click lands on what is under the pointer and keeps that relation:

- **An existing point** (including the **origin**): the new geometry shares it. That is the quickest way to anchor a shape at the origin.
- **The middle of a line** (a triangle marker): the new point stays in the middle.
- **A line, circle or arc** (a cross marker): the new point stays on it.

Lines drawn within 3° of horizontal or vertical become horizontal or vertical.

The keys are those of the CADence control style; other styles and the full list are under **?** ([[User guide/Viewing and controls]]). Press **Enter** to finish the sketch.

Select curves and press **X** to turn them into **construction geometry** (dashed). Construction curves help with constraints but are not part of profiles or exports. **Delete** removes the selection along with the relations on it.

## Constrain and dimension

Select geometry, then pick a relation in the toolbar. Buttons are enabled only when the selection fits:

| Relation | Select |
| --- | --- |
| ● Coincident | two points, or a point and a line, circle or arc (the point lies on it) |
| H / V Horizontal, vertical | a line, or two points (level with each other, or one above the other) |
| ∥ Parallel, ⊥ Perpendicular, ⋯ Collinear | two lines |
| T Tangent | a line and a circle or arc, or two circles/arcs |
| = Equal | two lines (length) or two circles/arcs (radius) |
| ◎ Concentric | two circles, arcs or ellipses |
| M Midpoint | a point and a line |
| ⇹ Symmetric | two points and a line: they mirror each other across it |
| ⚲ Fix | a point |

With the **Dimension** tool (D):

- **Click a line**, then click empty space: its length.
- **Click a circle or arc**: its diameter or radius.
- **Click two points**: their distance. A point and a line: the distance between them. Two lines: the angle.

Type the value and press Enter. Values are expressions with units: `40`, `2 * 20 mm`, `1 in`, `45 deg`, `sqrt(2) * 10`. Plain numbers are millimetres and degrees. Click a dimension's label to change it later.

Small badges show the relations on the geometry; click one and press Delete to remove it.

## Modify

The **Modify** menu changes the curves you have:

| Tool | How |
| --- | --- |
| Trim (T) | Click the piece of a curve to cut away. It goes up to the curves that cross it; the new end stays on the curve it met. A circle crossed twice becomes an arc. |
| Extend | Click near the end of a line or arc: it grows to the next curve in its way. |
| Split | Click a line or arc where it should break in two. |
| Sketch fillet | Set the radius in the toolbar, then click a corner where two lines meet: an arc tangent to both rounds it, with a radius dimension. |
| Sketch chamfer | Set the distance, then click a corner: a straight cut that far back along each line. |
| Offset the selection… | Select connected lines and arcs (or a circle) and enter a distance: a copy that far to the side, outward around a closed shape (negative: inward). Lines stay parallel to their originals. |

Trim, extend, split, fillet and chamfer work on lines, circles and arcs.

## Select, copy and move

- **Drag a box** on empty space with the select tool: left to right selects what lies inside it, right to left everything it touches. Shift keeps what was selected.
- **Ctrl+C**, **Ctrl+X** and **Ctrl+V** copy, cut and paste the selection, with the relations among it (not those to geometry outside it). The copy lands at the pointer and stays selected, so you can move it on. Dimensions keep their expressions.
- **Move** (M): click a base point, then where it goes. **Rotate**: click the centre, a direction, then the direction to turn to; horizontal and vertical relations on turned geometry are dropped, since they would turn it back.

## Mirror and patterns

- **Mirror**: select geometry, choose *Mirror the selection across a line* and click the line. Each point gets a twin held by a symmetric relation, so the image follows the original when you change it. Points on the line are shared.
- **Linear pattern**: select geometry and enter how many copies (the original counts) and the step in X and Y. Each copy keeps the relations among its curves and is placed by two dimensions you can change.
- **Circular pattern**: set the number of copies, then click the centre point. Construction spokes of equal length at the pattern angle place each copy; a turned copy keeps its shape but not horizontal or vertical relations.

### Curves from equations

**Shapes → Curve from equations…** draws a curve given by *x(t)* and *y(t)* for *t* from one value to another: involutes, cams, spirals, wavy outlines. Lengths are millimetres unless written with a unit, `sin` and `cos` take degrees, and parameters can be used (`r * cos(t)`). The curve runs smoothly through the given number of points and closes when it ends where it starts, so it can form a profile; it updates when its parameters change. Delete it like any curve.

### Pictures

Import a PNG or JPEG picture into the project, then:

- **Picture** (in the sketch toolbar) puts it behind the sketch to draw over, at 96 pixels an inch, its bottom left corner on the origin. It is placed by two points, the bottom corners: move them to move and turn it, and dimension the distance between them to give the picture its real width. The same menu sets its opacity, hides it, or removes it.
- **Insert drawing** traces the picture's dark shapes into curves: set how light a pixel may be to count as dark, and whether the outlines are smooth. As one piece, the traced drawing keeps its proportions and scales by its two handle points like an imported drawing.

## Projected geometry

The **Project** tool (in the Shapes menu) copies edges of bodies into the sketch: click an edge, or a face for its whole outline. The projected curves (in pink) follow the body when it changes, cannot be moved, and form profiles like any other curves. Toggle them to construction geometry with X; deleting one deletes the whole projection.

## Read the status

The toolbar and properties panel show how far the sketch is defined:

- **N degrees of freedom**: some geometry can still move. What can move is drawn in blue, with arrows at the points showing which way they can go (one arrow: along a line or curve; a cross: anywhere); what is already defined is drawn in the text colour. Add relations or dimensions until nothing can move, or click **Fully define**: CADence adds the relations and dimensions the sketch shows as drawn (horizontal and vertical lines, lengths, sizes, positions from the origin) in one undoable step.
- **Fully constrained**: nothing can move without changing a dimension (drawn in the text colour).

A change that contradicts existing constraints is refused, and a message names the relations involved and lists those you could remove instead: **Remove and apply** removes that one and makes your change. A change that would shrink a curve to nothing, such as a line both horizontal and vertical, is refused too. Undo and redo with Ctrl+Z and Ctrl+Y.

The **properties panel** lists the sketch's closed regions (profiles) and their areas. A circle inside a rectangle gives two profiles: the plate with a hole, and the disc.

## Export for laser cutting

While editing a sketch, **DXF** and **SVG** export it, without construction geometry:

- **DXF**: millimetre units, with lines, circles and arcs as true curves; ellipses and splines as polylines within 0.005 mm. Works with LightBurn, Inkscape, LibreCAD and laser software in general.
- **SVG**: sized in millimetres, with hairline black strokes and no fill. Ellipses and splines stay exact curves.

The browser downloads the file. The desktop app asks where to save it.
