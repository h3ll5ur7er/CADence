# Robot arm

A six-axis desktop robot arm with a two-finger gripper, modelled by an AI agent through the MCP server ([[User guide/Automation#AI agents (MCP)]]) as the second stress test after the [[Magnum opus]]: [[CAD-182]]. It lives in the project **Robot arm R6** in the desktop app's projects folder. The rule is the radial engine's: where CADence lacks a feature, the gap is filed as a task in the epic *Robot arm* and the work stops there; no workarounds.

[TOC]

## Status

**Round 1 (2026-10-21): modelled, moving and drawn; eleven findings filed.** The project has eleven components, three standard parts (bearings 6201 and 608, a screw M6 × 25) and the assembly *Robot arm*. It has 24 instances and 3 pattern copies, and 21 joints: J1 to J6 with limits, two finger sliders linked to move together, and 13 rigid joints for the motors, the bearings and a screw. Standing upright nothing overlaps. The study *Reach* takes every joint through its range (50 s, 501 moments) without a collision. *Pick and place* (12 s) collides once, because the gripper cannot carry the workpiece ([[CAD-187]]). There is an animation of it, the exploded view *Taken apart*, the upper arm's strength check and nine drawings (R6-00 to R6-08), all exported as PDF.

The arm was built against the merged phases 34 to 43 (master after #49), through the MCP server of that build.

## Why a robot arm

The radial engine stressed closed loops; the arm stresses the opposite:

- **A long open chain.** Six revolute joints in a row and two finger sliders after them: every pose of the gripper is the product of eight joint values, and a small error at the shoulder moves the fingers most.
- **Joint limits.** Every joint has a range; motion studies and value changes should stay inside it, and the collision check should find where the arm hits itself or its surroundings within it.
- **Reach.** Motion studies over the whole working range, and a pick-and-place cycle whose joint values are worked out by hand (CADence has no inverse kinematics, [[CAD-188]]).
- **Loads.** The upper arm carries the forearm, the wrist, the gripper and a payload at half a metre: the strength check of the links and the torque of the motors.
- **Things that bend.** Cables run through the links and across every joint.

## Main dimensions

Project parameters:

| Parameter | Value | Meaning |
| --- | --- | --- |
| `shoulder` | 170 mm | Height of the shoulder axis (J2) above the table |
| `upper` | 220 mm | Upper arm, shoulder axis to elbow axis (J2 to J3) |
| `fore` | 200 mm | Elbow axis to the wrist axis (J3 to J5), along the forearm |
| `flange` | 60 mm | Wrist axis to the gripper (J5 to J6's face: 58 mm, with a 2 mm gap) |
| `cable` | 6 mm | Cable bundle diameter |

The upper arm uses `upper` and the cable `cable`; joint offsets are numbers, since they take no expressions ([[CAD-185]]). The fingertips are 143 mm from the wrist axis, so the arm reaches about 560 mm from the shoulder.

## Joints and limits

| Joint | Moves | On | Offset on the first instance | Range |
| --- | --- | --- | --- | --- |
| J1 waist | Turret | Base | translate (0, 0, 60) | −170° … 170° |
| J2 shoulder | Upper arm | Turret | translate (0, 0, 110), tilt 90°, angle 90° | −90° … 90° (0 = upright) |
| J3 elbow | Elbow housing | Upper arm | translate (220, 0, 0) | −135° … 135° |
| J4 forearm roll | Forearm | Elbow housing | translate (68, 0, 52), lean 90°, tilt 90°, angle 90° | −180° … 180° |
| J5 wrist pitch | Wrist | Forearm | translate (0, 0, 132), lean 90°, tilt 90°, angle 90° | −120° … 120° |
| J6 flange roll | Gripper | Wrist | translate (58, 0, 0), lean 90°, tilt 90° | −360° … 360° |
| Finger A / B | Fingers | Gripper | translate (∓5, 0, 30), lean ∓90°, tilt 90°, angle 90° | 0 … 20 mm, B linked to A (ratio 1) |

Lean 90° and tilt 90° point a joint's axis along the instance's +X (lean −90° along −X); tilt 90° alone along −Y. Positive J2, J3 and J5 all bend the arm the same way, towards −X at J1 = 0. The elbow housing sits beside the upper arm (52 mm towards −Y), so the forearm folds past the upper arm, and the wrist is 52 mm off the arm's plane. The axes of J4, J5 and J6 meet, so the wrist is spherical.

## Coordinates

Every component is drawn in its **own joint frame**, so the joints use component origins with offsets and no faces:

- A link's **Z axis is the axis of the joint that moves it**, through its origin. The next joint's frame is an offset on the link.
- The base stands on the table's top (z = 0) with J1 along Z. In the upright pose (all joints 0) the arm points up along world Z.
- The table is moved 250 mm towards −X, so the arm works over it at J1 near 0. The pick spot is (−300, 120), the place spot (−150, −250).

## Parts (components)

| Part | Material | Mass | Notes |
| --- | --- | --- | --- |
| Base | Aluminium | 874 g | Revolved pedestal ⌀150 × 60, four M6 holes on ⌀135, 6201 seat, J1 motor inside |
| Turret | PETG | 516 g | Disc ⌀140 with a hub and a clevis (gap 54) for the shoulder, 6201 seats, J2 motor outside |
| Upper arm | Aluminium | 1,502 g | Bosses ⌀64 220 apart, I-section (pockets 130 × 34 × 20 from both faces), ⌀12 axles, a ⌀6 cable swept in the top pocket |
| Elbow housing | PETG | 293 g | Turns beside the arm on J3, a pocket for the J4 motor open on one side |
| Forearm | PETG | 142 g | Tube ⌀50/40 along J4, a fork with 608 seats for the wrist |
| Wrist | PETG | 69 g | Block between the fork's arms on ⌀8 axles, a pocket for the J6 motor |
| Gripper | PETG | 89 g | Flange ⌀40, body 80 × 30, a 10 × 6 rail for the fingers |
| Finger | PETG | 19 g | 55 × 24 × 12, slides on the rail; placed twice |
| Stepper motor | 4.1 g/cm³ | 292 / 106 / 52 g | Configurations NEMA 17, NEMA 11, NEMA 8 from its parameters (size, length, boss, shaft, screw pitch) |
| Table | Plywood | 5.3 kg | 650 × 600 × 20, four M6 holes for the base |
| Workpiece | Aluminium | 73 g | 30 mm cube |

The arm alone weighs about 4.7 kg; the upper arm is solid aluminium apart from its pockets and is the heaviest part.

## Assembly *Robot arm*

- Motors: NEMA 17 at J1 (inside the base), J2 (on the turret's side) and J3 (under the upper arm's elbow end); NEMA 11 at J4 (in the elbow housing) and J5 (outside the fork, 2 mm off it); NEMA 8 at J6 (in the wrist). Each shaft runs in a bore of the part it drives.
- Bearings from the standard parts, laid on their seats with `insert_library_part`: 6201 at J1, J2 (two) and J3, 608 at J5 (two). Seats that face the other way need `flip`.
- Four M6 × 25 screws: one inserted on a mounting hole, three more as a circular pattern.
- *Reach*: each joint in turn from 0 to its maximum, its minimum and back (8 s per joint), then the fingers open and close.
- *Pick and place*: home, above the cube with the fingers open, down, close to 10 mm, lift, across, down, open, up, home; all keys eased. The joint values come from a hand-written inverse kinematics script (waist from the side offset, shoulder and elbow from the two link lengths, wrist pitch so the tool points down, flange roll so the jaw lines up). It puts the fingertips within 0.01 mm of the target.
- *Taken apart*: 20 steps, from the fingers down to the screws.

## Checks

| Check | Result |
| --- | --- |
| Overlaps, upright | None (after shaft bores, a motor boss recess, shorter axles and two bearings turned over) |
| Overlaps, reaching into the table (J2 −90°, J3 −90°) | Forearm, wrist and J5 motor in the table: the check finds them |
| *Reach*, 10 per second | 501 moments, no collision |
| *Pick and place*, 20 per second | Finger B and the cube at 3.6 s: the cube stays behind ([[CAD-187]]) |
| Upper arm, held at the shoulder axles, 21.5 N at the elbow | 2.75 MPa with the default mesh, 12.7 MPa at 2.5 mm elements ([[CAD-190]]); by hand about 12 MPa in the axles |
| Torque at the shoulder, arm out straight, 1 kg payload | By hand about 11 N·m; CADence cannot tell ([[CAD-189]]) |

## Findings

| Task | Finding |
| --- | --- |
| [[CAD-184]] | A joint offset that is not a number is taken, and moves the chain after it to NaN (bug) |
| [[CAD-185]] | Joint offsets take no parameters; lean, tilt and angle instead of an axis direction |
| [[CAD-186]] | Joint limits clamp values, keys and drives without a word |
| [[CAD-187]] | A motion study cannot carry a part (the gripper picking up the cube) |
| [[CAD-188]] | No inverse kinematics: tool targets to joint values |
| [[CAD-189]] | No joint torques for choosing motors |
| [[CAD-190]] | The strength check's default mesh is too coarse to trust |
| [[CAD-191]] | The strength check has no weight, remote loads or moments |
| [[CAD-192]] | No 3D sweep paths, no cables that follow the joints |
| [[CAD-193]] | Drawings: texts overflow the parts list and title block; views cannot leave parts out |
| [[CAD-194]] | Standard parts: no larger or thin-section bearings, no stepper motors |

What worked well: configurations of one motor component placed in three sizes, library bearings inserted on seat edges, a circular pattern of a library screw, collision checks over a 50 s study in 5 s, animations, exploded views, drawings with parts lists and balloons.
