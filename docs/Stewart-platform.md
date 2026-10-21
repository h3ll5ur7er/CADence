# Stewart platform

A six-legged Stewart platform (hexapod), modelled by an AI agent through the MCP server as the third stress test, after the [[Magnum opus]] and the [[Robot arm]]: [[CAD-183]]. It lives in the project **Stewart platform S6** in the desktop app's projects folder. The rule is the same: gaps are filed as tasks in the epic *Stewart platform*, without workarounds.

[TOC]

## Status

**Round 1 (2026-10-21): modelled and moving; four findings filed, three more added to the robot arm's.** The assembly *Stewart platform* has 14 instances and 18 joints in six closed loops through the top plate. It has two motion studies, *Tilt, turn and lift* (10 s) and *Reach* (17 s), and an animation of the first. Nothing overlaps at home or in either study. Setting the legs one after another does not work: each one set moves the others ([[CAD-195]]).

## Why a Stewart platform

Simple parts, hard motion. The six legs' lengths set the plate's six freedoms, so every pose is a closed-loop problem with six inputs at once, the opposite of the radial engine's single crank. Driving the plate means working out the leg lengths for a pose (inverse kinematics, easy for this mechanism), and reading where the plate went from leg lengths (forward kinematics, hard).

## Geometry

| | Value |
| --- | --- |
| Base ball centres | Radius 120 mm, at 15°, 105°, 135°, 225°, 255°, 345°, 34 mm above the table |
| Top ball centres | Radius 80 mm, at 45°, 75°, 165°, 195°, 285°, 315°, 19 mm below the plate |
| Legs | Base 15° to top 45°, 105° to 75°, 135° to 165°, 225° to 195°, 255° to 285°, 345° to 315° |
| Leg length | 232 mm plus the stroke (0 … 100 mm), ball centre to ball centre |
| Home | Plate's underside 327.5 mm above the table, level: every leg 282 mm, mid-stroke, leaning 13.2° |

## Parts

| Part | Material | Mass | Notes |
| --- | --- | --- | --- |
| Base plate | Aluminium | 2.82 kg | ⌀300 × 15, six seats ⌀24 × 10, a ⌀60 hole for cables |
| Top plate | Aluminium | 1.00 kg | ⌀200 × 12, six seats underneath, a ⌀60 hole |
| Cylinder | Aluminium | 187 g | Ball ⌀18 at its origin, neck, body ⌀30 to 172 mm with a ⌀20 bore |
| Rod | Steel | 294 g | ⌀16 from 120 mm inside the cylinder, ball ⌀18 60 mm above the cylinder's top |

The whole platform weighs 6.7 kg.

## Assembly *Stewart platform*

- Per leg: a ball joint from the base plate to the cylinder (at the ball centre), a slider from the cylinder's top to the rod (limits 0 … 100 mm), and a ball joint from the rod's ball to the top plate. The six top balls close six loops.
- A ball joint turns about its frame's z (yaw), then the new y (pitch), then the new x (roll). With the lower ball's yaw towards the leg and its pitch the leg's tilt, every value of the home pose was worked out by hand (a script, `pose()`), and the plate landed exactly at home.
- *Tilt, turn and lift*: keys for all six legs at a 10° roll, a 10° pitch, a 20° turn, a 40 mm lift and a 40 mm shift, home in between, eased.
- *Reach*: a turn in 5° steps to 45°, then a lift in 12 mm steps to 72 mm, which asks 120.5 mm of each leg.

## Checks

| Check | Result |
| --- | --- |
| Overlaps at home | None |
| *Tilt, turn and lift* and *Reach* | 101 and 171 moments, no collisions; a turn of 45° clears |
| Set leg 1 to 80 mm | 58.7 mm; the other legs moved instead ([[CAD-195]]) |
| Set all six legs for a 10° roll | Off by up to 6.6 mm of stroke; only the last leg keeps its value |
| Write all 18 joints' values for home | 0.8 mm off, strokes up to 2 mm off |
| Keys for all six legs in a study | Held: the plate tilts about 10° at 1 s, by eye; no numbers to check it ([[CAD-196]]) |
| Lift past the stroke | Stops at 100 mm from 14.3 s on, without a word ([[CAD-186]]) |
| A base ball limited to 10° pitch (home 13.2°) | Kept; the plate moves 13 mm, without a word ([[CAD-186]], [[CAD-197]]) |
| Undo in a new server process | Nothing undone, answered as if it worked ([[CAD-198]]) |

## Findings

| Task | Finding |
| --- | --- |
| [[CAD-195]] | Several joints cannot be set together or held: parallel mechanisms cannot be driven by their legs |
| [[CAD-196]] | A study's moment has no numbers (poses, joint values) |
| [[CAD-197]] | No universal joints; ball joint limits are per angle, not a cone |
| [[CAD-198]] | Undo with nothing to undo answers as if it worked |
| [[CAD-186]] | (robot arm) Limits are kept without a word, also in closed loops |
| [[CAD-188]] | (robot arm) No inverse kinematics: the plate's poses were worked out outside CADence |

What worked well: six closed loops with ball joints solve at once from the hand-made values, a study with keys for all six legs holds them all, collision checks over 171 moments in about 10 s.
