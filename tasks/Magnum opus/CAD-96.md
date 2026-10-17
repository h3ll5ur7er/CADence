---
id: CAD-96
title: "Magnum opus: a nine-cylinder radial engine as a stress test"
type: chore
status: review
priority: high
labels: [stress-test, mcp]
---

Model a nine-cylinder radial aircraft engine through the MCP server, as an AI agent would, to find the limits of CADence: many parts, nine closed slider-crank loops on one master rod, gear links, instance patterns, a motion study and an exploded view. Every bug or missing feature found along the way becomes its own task; where a feature is missing, the work stops there until it exists (no workarounds). The design, the plan for the assembly and the findings are in [[Magnum opus]].

Done means: every part is modelled, the assembly animates (crank driving all nine pistons, the cam ring and the propeller through the reduction gear) and comes apart in an exploded view, and the findings are filed.

**Status (2026-10-17, round 4): the engine is complete.** It has no overlaps standing still, no collisions over four engine cycles of the study, an animation and the exploded view. Round 3's fixes ([[CAD-116]] to [[CAD-119]]) work on the engine. The nine tappet guides now give one slider constant (67.0902 mm) in a new process and in the MCP server alike. The MCP server picked up a component edit and an assembly change made by another process. The cam link offsets are set from that constant, and all gears are phased. Round 4 found three new issues. [[CAD-120]]: one big jump of the crank with `set-joint-values` flipped the nine loops into their mirror pose and saved it; repaired from the project history. [[CAD-121]]: the shape cache evicts its own placed parts in long scripts on large assemblies. [[CAD-122]]: animations re-frame the camera on every frame. None blocks the engine.

## Parts (components, through `edit_component`)

- [x] Crankcase, front and rear half as configurations of one component (nine-sided; a round drum with pads works now too, [[CAD-103]])
- [x] Crankshaft with counterweight
- [x] Master rod with eight knuckle pins (circular pattern of new bodies)
- [x] Link rod
- [x] Piston and wrist pin
- [x] Cylinder barrel (eleven fins)
- [x] Cylinder head (fins, rocker boxes outboard for the pushrods, ports, plug bosses)
- [x] Spark plug (modelled M10 thread), pushrod, roller tappet, intake pipe and exhaust stub (sweeps)
- [x] Cam drive: crank gear 48T, lay gear 60T/12T, cam ring with two five-lobe tracks and a 96T gear
- [x] Reduction gear: sun 24T, planet 18T, ring gear 60T (internal, [[CAD-98]]), planet carrier with propeller shaft
- [x] Nose case with nine tappet guides
- [x] Propeller blade (loft from a round root through five twisted airfoil sections, [[CAD-106]]), hub and spinner
- [x] Rear case with nine intake bosses, magneto, display stand

## Assembly *Radial engine* (through `edit_assembly`)

- [x] 79 instances: grounded cases, stand, ring gear and nine barrels; crankshaft, master rod, eight link rods, nine pistons and wrist pins, cam ring, lay gear, nine tappets, nine pushrods, carrier, planets, hub, spinner, blade
- [x] 66 joints, nine closed slider-crank loops through the master rod (cylindrical piston joints); solved at 0° and 90° of crank angle, values match the hand-computed kinematics
- [x] Links: lay gear −48/60, cam ring −12/96 (cam at 1/10), carrier 2/7, planets −20/21, nine cam followers (roller tappets) with computed profiles ([[CAD-99]])
- [x] Patterns: heads, exhaust, intake and two plugs ×9; blades ×3 on the turning hub (42 copies)
- [x] Motion studies *Running at 60 rpm* (constant crank speed, 16 s) and *One cycle (720°)* (2 s)
- [x] Mass, bill of materials, interference check
- [x] Pictures of the whole engine, in motion and exploded ([[CAD-109]], [[CAD-115]])
- [x] Exploded view *Taken apart*: 21 steps, every cylinder's parts outwards by radial steps ([[CAD-110]])
- [x] Pushrods following the tappets (tilted rigid joints, [[CAD-113]])
- [x] Fix my own design interferences (rear case recess and ports, blade shank and hub sockets, piston crown, tilted plugs, tappet guides, roller tappets, rocker box pockets)
- [x] Measure the tappets' slider constants again and set the cam link offsets: 67.0902 mm on all nine guides (in a new process and in the MCP server alike), offset −8.8961 mm
- [x] Phase the gears: sun turned half a tooth (7.5°) and crank gear half a tooth (3.75°) on the crankshaft; the last pushrod clears its rocker box (it touched only with the wrong tappet heights)
- [x] Phase the lay pinion against the cam gear: the study check found them touching at 0.9 s; a scan of the phase (on a copy) found them clear between 1.0° and 2.75° of cam offset, so the pinion turns half a tooth (15°) in the lay gear component, which keeps the valve timing
- [x] Collision check of the study ([[CAD-114]]): no collisions in 82 moments (8.1 s, four engine cycles; the valve train repeats every two turns) in its ten-minute limit
- [x] Animation: study *One cycle (720°)*, 2 s; GIFs of the whole engine and of the crank train

## Findings

Round 1 (all done in phase 26, [[CAD-104]] reopened for joins):
[[CAD-97]] [[CAD-98]] [[CAD-99]] [[CAD-100]] [[CAD-101]] [[CAD-102]] [[CAD-103]] [[CAD-104]] [[CAD-105]] [[CAD-106]] [[CAD-107]] [[CAD-108]]

Round 2:

- [[CAD-109]] Pictures and animations of large assemblies crash (blocking)
- [[CAD-110]] Exploded views cannot move pattern copies (missing, blocking)
- [[CAD-111]] Leaner assembly answers, a readable command reference, `near` by geometry
- [[CAD-112]] Joint frames on pattern copies point either way (and smaller assembly issues)
- [[CAD-113]] Joint offsets cannot tilt a frame (missing)
- [[CAD-114]] Collision check of a study too slow for large assemblies, no progress
- [[CAD-115]] Pattern copies stand still in motion studies

Round 3:

- [[CAD-116]] The MCP server's open assembly keeps old parts after `edit_component` (blocking)
- [[CAD-117]] Joint frames on round faces depend on the face's axis-aligned box
- [[CAD-118]] Unclear refusals and silent no-ops (edit-feature type, move-point on fixed points, revolve near its axis, one-plane tilt)
- [[CAD-119]] One empty result file makes an assembly impossible to open

Round 4:

- [[CAD-120]] A big jump of a driving joint flips closed loops into their mirror pose, and the flip is saved
- [[CAD-121]] Publishing a large assembly fails after a few moves (shape cache evicts its own parts; WebAssembly faults in long scripts)
- [[CAD-122]] Animations re-frame the camera on every frame (and smaller animation issues)
