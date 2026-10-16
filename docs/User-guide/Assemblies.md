# Assemblies

Put components together, connect them with joints, move them, and play and record their motion. An assembly is a document of its own in the project; it uses the project's components and follows their changes.

[TOC]

## Insert components

Create an assembly with **Assembly** in the documents panel, then **Insert** a component from the toolbar. Insert the same component as often as you need: every copy is an *instance* (*Bracket 1*, *Bracket 2*, …).

- The first instance is **grounded** (a pin in the browser): it never moves. Ground or unground any instance in its properties.
- A component with configurations offers them in the instance's properties: each instance can show another variant (*Bracket (Long)*).
- New instances start to the right of the others. Select an instance that no joint places and drag its **arrows** in the view, or type its **Position** (X, Y, Z in mm and a turn about Z).
- Select an instance a joint places to drag it along the joint's free directions: arrows for a slider (or the sliding of a cylindrical, pin-slot or planar joint), a ring for a revolute joint. The joint's values follow.
- While a component is being rebuilt, its instances show *loading*. When you change a component, in this tab or in another tab or window, its instances update. A deleted component shows *missing*.

## Joints

Click **Joint**, choose the type, then click a face or edge on the part that **stays**, and one on the part that **moves**. The moving part snaps into place.

| Type | Moves | Values |
| --- | --- | --- |
| Revolute | turns about the axis (a hinge, a wheel) | angle |
| Slider | slides along the axis (a drawer) | distance |
| Cylindrical | turns and slides along the axis | angle, distance |
| Pin-slot | slides sideways and turns | slide, angle |
| Planar | moves on the plane and turns | X, Y, angle |
| Ball | turns about the point | yaw, pitch, roll |
| Rigid | nothing | |

Where a joint sits depends on what you click:

- **Hole, shaft or circular edge:** its axis. A rim (the circular edge at the top or bottom of a hole) is the most precise: it also fixes the height.
- **Flat face:** its centre, with the axis straight out of the face. Two flat faces meet face to face.
- **Straight edge:** its middle, with the axis along the edge.

Select a joint to drag its values with the sliders (or type them), to set **limits**, or to **turn the moving side over**. Its **offsets** move each side's joint origin away from what you clicked: X and Y along the face or edge, Z along the joint's axis (mm), and **Turn** about the axis (°). A hinge 10 mm above a plate, or a part turned 45° on its pin, needs no extra geometry. Joints that close a loop, like a four-bar linkage, are kept closed: dragging one joint moves the others. A change that no joint arrangement can satisfy is refused with the reason.

## Motion links

**Link** makes one joint drive another, so a mechanism moves as one:

| Kind | Enter | Ratio |
| --- | --- | --- |
| Gears | the teeth of both gears | turns the other way, teeth over teeth (20 driving 10: −2) |
| Rack and pinion | the pinion's pitch diameter | π × ⌀ / 360 mm of rack per degree |
| Belt or chain | both pulley diameters | turns the same way, diameter over diameter |
| Sun to planet carrier | the teeth of the sun and of the ring (fixed) | sun ÷ (sun + ring) of the sun's turn (24 and 60: 2/7) |
| Sun to planet | the teeth of the sun and of the ring (fixed); the driven joint turns the planet on its pin on the carrier | the other way, sun ÷ planet × (1 − the carrier's ratio) (24, 60: −20/21) |
| Cam and follower | the profile: the cam's angle (0 to 360°) and the follower's lift (mm, or degrees for a turning follower), one pair a line | the follower follows the profile, smooth between its points and round again every turn; the scale multiplies the lift |

Choose the driving and the driven joint (and which of their freedoms), or type the ratio; **The other way round** reverses it. The driven joint keeps where it is when the link is made and follows from then on; links can chain (a gear train), but not in a circle, and a joint follows one link.

## Patterns and mirrors

**Pattern → Linear pattern**, **Circular pattern** or **Mirror** repeats instances: in a row along X, Y or Z with a spacing, around an axis (through a point) with an angle between copies, or mirrored across a plane. Count includes the originals. Copies follow their originals (moving them, their joints, their configuration and the component's changes) and are part of checks, measures, mass and exports, but cannot be joined themselves. Edit or delete a pattern in the browser.

## Measure and mass

- **Measure** (the ruler) measures faces, edges and corners of any instances where they are: one gives its size; two give the distance and the angle between them.
- With nothing selected, the assembly's properties show its **mass**, **volume** and **centre of mass**, from each component's material (copies included, hidden instances left out).

## Motion studies

Click **Motion** to start a study. It has a duration and *keys*: a joint's values at a moment.

1. Select the joint and set its values for a moment.
2. Select the study, set **Time**, choose the joint, and click **Key at current values**.
3. Press **Play**, or drag the time slider to look at any moment. Between keys, values change evenly.

**Record video** plays the study from the start and saves it as a WebM video.

- **Ease** on a key makes the motion into it start and end slowly instead of evenly.
- **Constant speeds** turn a joint at a speed (rpm) or slide it (mm/s) from where it is at the start, for the whole study; they win over keys of the same joint. Linked joints follow.
- **Check collisions** plays the study (10 frames a second) and lists the parts that hit each other with the moment they first do. Click one to see it, the parts in pink; **Stop playing at the first hit** ends playback there.

## Exploded views and build instructions

**Explode** starts an exploded view: choose the instances the next step moves, **Add step**, and set its direction and distance. Steps add up, one after the other; the **Shown** slider takes the assembly apart step by step, with lines from where each part was.

**Build instructions (PDF)** makes an A4 document: the parts list and the assembly taken apart, then one page per step, fitting the parts in the reverse order of the exploded view, and the finished assembly. Pictures are taken from the home direction, all framed alike.

## Bill of materials

The **bill of materials** (the stacked squares) lists every component (and configuration) with its count, material and mass, copies of patterns included. **Export CSV** saves it for a spreadsheet.

## Check and export

- **Check interference** (the overlapping squares) lists every pair of instances whose solids overlap, with the overlapping volume, and shows them in pink. Parts that only touch do not count.
- **Export**: STEP with one named solid per instance, 3MF with one object per instance, or STL and OBJ meshes of the whole assembly.
