# Drawings

Technical drawings of components and assemblies: views on a sheet with a title block, dimensions, notes and callouts, printed as PDF or handed on as DXF. A drawing is a document of the project; its views follow the model when it changes.

[TOC]

## The sheet

Create a drawing with **Drawing** in the documents panel. With nothing selected, the properties show the **sheet** (A4 to A1, landscape or portrait), its **scale** (10:1 to 1:20) and the **title block**: title (the drawing's name when empty), number, revision, material and who drew it. The title block also shows the scale, the sheet size and the date.

Scroll to zoom and drag the paper to pan; **Fit the sheet** shows all of it.

## Views

**View** adds a view of a component or an assembly, seen from the front, top, right, left, back, bottom or isometric (from the front, right and above), with or without **hidden lines** (dashed). Views are placed side by side; drag a view to move it. Select a view to change where it looks from, its own **scale** (instead of the sheet's), hidden lines and its **label**, or to delete it.

- **Section:** a view cut through the middle of the model across the viewing direction (or nearer the viewer by an offset), the part in front taken away; cut faces are hatched. Its label starts as *Section A-A*.
- **Detail** (the magnifier): click the middle of the detail in a view. A circle of it is drawn twice as large below it, labelled *Detail B* (and the circle marked on the view).

Views of an assembly show its parts where the assembly puts them. The assembly's editor places them for drawings whenever it changes: open an assembly once before drawing it.

## Dimensions and notes

- **Dimension:** aligned, horizontal or vertical between two corners, radius or diameter of a circle, or the angle between two straight edges. Pick them on the sheet (the nearest one lights up); the value is measured on the model, in millimetres, whatever the view's scale. Select a dimension to move its line further from the geometry or to replace its text.
- **Note:** click where it goes, then type its text (several lines are fine) in the properties.
- **Centre mark** on a circle, **centre line** between two corners or circles.
- **Hole callout:** click a hole, then where the text goes. A hole made with the Hole feature says how many there are, its diameter, depth or *thru*, counterbore or countersink and thread (*2 × M6 thread*, *2 × ⌀5 thru*); other holes give their diameter.

Dimensions stay attached to the model's geometry by its persistent names, so they follow changes. An annotation whose geometry is gone is listed in the drawing's properties.

## Parts lists and balloons

On a view of an assembly, **Parts list** puts a table of its parts (item, name with configuration, count with copies of patterns, material) where you click its top right corner. **Balloon:** click a part in the view, then where the balloon goes; it shows the part's item number.

## Export

**Export → PDF** gives the sheet at its size with ISO line widths (model edges 0.5 mm, hidden and thin lines 0.25 mm). **DXF** gives lines and texts in millimetres, on the layers VISIBLE, HIDDEN, DIMENSIONS, CENTER, HATCH, FRAME and TEXT.
