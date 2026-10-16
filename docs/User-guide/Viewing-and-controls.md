# Viewing and controls

How to look around the model, cut into it, change how bodies look, and drive CADence with the mouse and keys you are used to.

[TOC]

## Move around

| | CADence (default) | Fusion 360 style | Onshape style |
| --- | --- | --- | --- |
| Orbit | Left drag | Shift + middle drag | Right drag |
| Pan | Right drag, or Shift + left drag | Middle drag | Middle drag, or Ctrl + right drag |
| Zoom | Wheel or middle drag | Wheel, toward the cursor | Wheel, toward the cursor |
| Select | Left click | Left click | Left click |

Choose the style under **Settings** (the gear at the top right, or press **?**). The setting is kept on this computer, for every project.

The buttons under the view cube:

- **Home view** looks at the origin from the front right.
- **Zoom to fit** frames everything shown, from the direction you are looking.
- **Perspective / orthographic**: in an orthographic view, parallel edges stay parallel, which makes sizes easy to compare. The choice is kept, like the control style.
- **Section view** cuts the bodies (or the assembly's parts) with a plane, so you can see inside. Choose the plane (XY, XZ, YZ, or parallel to a selected flat face), move it with **Offset**, and **Flip** the side that is cut away. The cut is drawn in orange. The section only changes the view, never the model; measurements and picks ignore what is cut away.

Click a face of the view cube to look straight at the model from that side.

## How bodies look

In a component, each body is listed under **Bodies** in the browser. The eye hides or shows it. In the panel on the right, each body has a **colour** and an **opacity** slider; **Reset** returns it to the default. Hidden bodies are not drawn or picked, but they still count for mass and are still exported.

In an assembly, the eye next to an instance hides it, and the selected instance has its own colour and opacity. An instance shows its component's colours unless you give it its own.

Looks are saved with the document and can be undone like any change.

- **Finish:** matte (the default), plastic, metal, glass (see-through) or wood (wood-coloured unless the body has a colour). Finishes show best with **realistic lighting** (the sun button beside the view cube): the light of a room reflected on the surfaces, and shadows on the ground under the model. The setting is kept for all projects.
- **Picture or turntable…** (in **Export**) saves the view as you see it, without grid and origin: a PNG of any size (up to 8000 × 8000 pixels), on white or a transparent background, or a video of the model turning once around (WebM, 2 to 60 seconds).

## Surface analysis

The wavy button beside the view cube colours the faces to show their shape instead of their looks:

- **Zebra stripes:** stripes that run on smoothly across an edge mean the faces meet smoothly (tangent or better); a kink in the stripes is a crease.
- **Curvature:** flat faces blue, the most tightly curved red (scaled to the model).
- **Draft angle:** against a pull direction (Z up, Y or X) and a least draft. Faces green draw out along the pull, blue the other way; yellow ones are too close to parallel to the pull and need more draft to come out of a mould.

## Keyboard shortcuts

Press **?** for the full list of the chosen control style. Shortcuts never fire while you type in a field.

**Ctrl+K** opens the **command palette**: type a few letters of any tool, feature, command, document or setting (`lft` finds *Loft*) and press Enter. It lists what can run where you are (in a sketch, the sketch tools), with their shortcuts.

With the CADence style:

| Where | Keys |
| --- | --- |
| Everywhere | **Ctrl+K** command palette · **?** shortcuts and settings · **Ctrl+Z** undo · **Ctrl+Y** or **Ctrl+Shift+Z** redo · **Esc** cancel |
| View | **F** zoom to fit · **H** home · **1**–**6** front, back, left, right, top, bottom · **O** perspective or orthographic · **Shift+X** section on or off |
| Part modeling | **S** new sketch · **E** extrude · **R** revolve · **Shift+F** fillet · **Shift+C** chamfer · **Shift+L** shell · **Shift+P** construction plane · **M** measure · **Shift+V** parameters |
| Sketch | **S** select · **L** line · **R** rectangle · **C** circle · **A** arc · **P** point · **D** dimension · **X** construction · **Delete** delete · **Enter** finish |

The Fusion 360 style uses **F6** to fit, **F** for fillet and **I** to measure. The Onshape style uses **F** to fit, **Shift+1** to **Shift+7** for the standard views, **Shift+S**, **Shift+E** and **Shift+R** to sketch, extrude and revolve, **G** for rectangles and **Q** for construction geometry.
