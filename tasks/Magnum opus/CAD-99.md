---
id: CAD-99
title: Cam joints (a follower riding on a cam)
type: feature
status: done
priority: medium
labels: [assemblies, motion, found-by-CAD-96]
---

Motion links are linear (`driven = offset + ratio × driver`), and no joint keeps a follower on a curved face, so nothing in an assembly can move by a cam: a radial engine's tappets, pushrods, rockers and valves ([[CAD-96]]), a clock's snail and rack, a cam-driven toy. Motion studies can key such motion by hand, but not together with a constant speed drive, which wins over keys.

- [x] A cam link or joint: a follower (slider or revolute) whose value follows the cam's profile as its driver turns, either from a table (angle → lift) or from the cam face's geometry
- [x] Shown in motion studies and in collision checks like other links

**Done (phase 26)**, from a table: a motion link of kind `cam` has a `profile` of [angle, lift] pairs over one turn, smooth between them (periodic Catmull-Rom, `camLift`), so `driven = offset + scale × lift(driver)`. It works in motion studies and their collision checks like the other links, and the link panel edits the profile. A profile read from the cam face's geometry is left for later ([[Open points]]).
