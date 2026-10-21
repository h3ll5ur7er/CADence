# Drawings

Technical drawings of components and assemblies: views on a sheet with a title block, dimensions, notes and callouts, printed as PDF or handed on as DXF. A drawing is a document of the project; its views follow the model when it changes.

[TOC]

## The sheet

Create a drawing with **Drawing** in the documents panel. With nothing selected, the properties show the **sheet** (A4 to A1, landscape or portrait), its **scale** (10:1 to 1:20) and the **title block**: title (the drawing's name when empty), number, revision, material (the drawn component's when empty) and who drew it. The title block also shows the scale, the sheet size and the date.

Scroll to zoom and drag the paper to pan; **Fit the sheet** shows all of it.

## Views

**View** adds a view of a component or an assembly, seen from the front, top, right, left, back, bottom or isometric (from the front, right and above), with or without **hidden lines** (dashed). A component with configurations can be shown in any of them (**Configuration**), say both halves of a split case. Views are placed side by side; drag a view to move it. Select a view to change its configuration, where it looks from, its own **scale** (instead of the sheet's), hidden lines and its **label**, or to delete it.

- **Section:** a view cut through the middle of the model across the viewing direction (or nearer the viewer by an offset), the part in front taken away; cut faces are hatched. Its label starts as *Section A-A*. A view of the same part that sees the cut edge on shows where it is: a chain line, thick at its ends, with arrows the way the section looks and its letter.
  - **Half section:** only the half right of the view's centre line is cut; the centre line is drawn between the halves, and the cutting line runs from the middle out.
  - **Offset section:** **Steps** move the cut to another depth part of the way across, so one section passes through holes that are not in line. `10:-5` means: from 10 mm right of the model's middle on, cut 5 mm further from the viewer (several steps with semicolons; **Steps along** the view's up instead of its right). The steps are not drawn in the section; the cutting line on the other view steps with it, thick where it turns.

A view is drawn exactly. Where that takes longer than 20 seconds, it is drawn from the model's triangles at once and its properties say so; the exact view goes on being drawn in the background, one view at a time, and takes its place when done (even after the drawing was closed: it is kept for next time). Views being drawn show *Drawing…*; the others can be worked on meanwhile. Drawn views are kept with the drawing, so it opens at once next time.

**Threads** are drawn as ISO 6410 draws them, whether shown as a marker or modelled: from the side, a thin line along the minor diameter of a threaded shaft (the major diameter of a tapped hole) and a thick line where the thread ends; seen along the axis, a thin three-quarter circle. Hidden threads are dashed. A modelled thread is drawn from the part with its groove filled in, so its views take seconds, not minutes. Threads made before this version appear once their component has changed.
- **Detail** (the magnifier): click the middle of the detail in a view. A circle of it is drawn twice as large below it, labelled *Detail B* (and the circle marked on the view).

A view can leave parts out: bodies of a component, instances of an assembly (agents set its `hide`), say the table an arm stands on, which would otherwise set the sheet's scale.

Views of an assembly show its parts where the assembly puts them, and each part's corners, edges, holes and outlines can be dimensioned. The assembly's editor places them for drawings whenever it changes: open an assembly once before drawing it.

## Dimensions and notes

- **Dimension:** aligned, horizontal or vertical between two corners or circle centres (a centre distance), radius or diameter of a circle, a diameter between the two outlines of a cylinder or cone seen from its side (a shaft), or the angle between two straight edges. Spheres offer their outline as a circle, rings seen from above their rims, other round faces their outermost points. Pick them on the sheet (the nearest one lights up); the value is measured on the model, in millimetres, whatever the view's scale. Only what the view shows can be picked: with hidden lines off, holes behind the surface are not offered. Select a dimension to move its line further from the geometry, to turn a radius or diameter's leader (**Leader angle**; empty: where its text fits on the sheet) or to replace its text.
  - **Tolerance:** ± a value, deviations (written small after the value, upper over lower), limits of size (the largest over the smallest size, which follow the model), or an **ISO fit**: a class such as *H7* (holes, capitals) or *g6* (shafts), or a fit such as *H7/g6*, with its deviations from ISO 286 if you like (sizes up to 500 mm, grades IT5 to IT12, holes D to P and JS, shafts d to p and js).
  - **Isometric views:** a length between two corners is the true length in the model, not the shorter one on the sheet. **Measure along** a model axis to dimension along an isometric axis: the line runs along it, the extension lines along another.
- **Surface finish** (the tick): click a straight edge or outline, then the side of it the symbol stands on; or click free space for a symbol on its own. Its properties set how the surface is made (material removed: a bar closes the tick; no material removed: a circle in it; any), the roughness (*Ra 3.2*, written under the bar) and the method (*milled*, above it), as ISO 1302 draws them.
- **Note:** click where it goes, then type its text (several lines are fine) in the properties.
- **Centre mark** on a circle, **centre line** between two corners or circles.
- **Hole callout:** click a hole, then where the text goes. A hole made with the Hole feature says how many there are, its diameter, depth or *thru*, counterbore or countersink and thread (*2 × M6 thread*, *2 × ⌀5 thru*); other holes give their diameter. A thread's three-quarter circle calls out the thread: a tapped hole as above, a threaded shaft its size and length (*M10 thread*, *length 8*).


Dimensions stay attached to the model's geometry by its persistent names, so they follow changes. An annotation whose geometry is gone is listed in the drawing's properties.

## Parts lists and balloons

On a view of an assembly, **Parts list** puts a table of its parts (item, name with configuration, count with copies of patterns, material) where you click its top right corner. Its columns are as wide as their texts; where the frame comes too near, the text gets smaller (down to 2 mm) and then shortened with an ellipsis, so the table never runs past the frame. The title block does the same with a long title or value. Agents see where each annotation is drawn: `get_drawing` gives every annotation's box on the sheet, texts included, and an edit answers with the boxes of what it placed, so a parts list that would cover a view shows before a picture does. **Balloon:** click a part in the view, then where the balloon goes; it shows the part's item number.

## Export

**Export → PDF** gives the sheet at its size with ISO line widths (model edges 0.5 mm, hidden and thin lines 0.25 mm). **DXF** gives lines and texts in millimetres, on the layers VISIBLE, HIDDEN, DIMENSIONS, CENTER, HATCH, FRAME and TEXT.
