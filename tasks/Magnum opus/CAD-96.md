---
id: CAD-96
title: "Magnum opus: a nine-cylinder radial engine as a stress test"
type: chore
status: in-progress
priority: high
labels: [stress-test, mcp]
---

Model a nine-cylinder radial aircraft engine through the MCP server, as an AI agent would, to find the limits of CADence: many parts, nine closed slider-crank loops on one master rod, gear links, instance patterns, a motion study and an exploded view. Every bug or missing feature found along the way becomes its own task; where a feature is missing, the work stops there until it exists (no workarounds). The design, the plan for the assembly and the findings are in [[Magnum opus]].

Done means: every part is modelled, the assembly animates (crank driving all nine pistons, the cam ring and the propeller through the reduction gear) and comes apart in an exploded view, and the findings are filed.

**Status (2026-10-17, round 3): unblocked again.** All round 3 findings ([[CAD-116]] to [[CAD-119]]) are done in phase 28; joint frames on round faces moved to the middle of the face ([[CAD-117]]), so the tappets' slider constants have to be measured again. Before: stopped at [[CAD-116]]. The MCP server's open assembly keeps the parts as they were before `edit_component` changed them, so its checks, pictures and joint frames describe old geometry. Every round-2 fix is checked on the engine (whole-engine pictures, exploded view across pattern copies with radial steps, blades turning together, tilted pushrod joints, brief answers); the collision check of the study ([[CAD-114]]) waits for [[CAD-116]], since it would check the old parts. My design mistakes are fixed in the parts (a new process finds only the unphased gears and one pushrod touching its head). The tappets' cam link offsets have to be measured again once [[CAD-116]] and [[CAD-117]] are fixed.

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
- [x] Motion study *Running at 60 rpm* (constant crank speed, 16 s)
- [x] Mass, bill of materials, interference check
- [x] Pictures of the whole engine, in motion and exploded ([[CAD-109]], [[CAD-115]])
- [x] Exploded view *Taken apart*: 21 steps, every cylinder's parts outwards by radial steps ([[CAD-110]])
- [x] Pushrods following the tappets (tilted rigid joints, [[CAD-113]])
- [x] Fix my own design interferences (rear case recess and ports, blade shank and hub sockets, piston crown, tilted plugs, tappet guides, roller tappets, rocker box pockets)
- [ ] Measure the tappets' slider constants again and set the cam link offsets — after [[CAD-116]], [[CAD-117]]
- [ ] Phase the gears (link offsets of half a tooth); clear the last pushrod in its rocker box
- [ ] Collision check of the study ([[CAD-114]]) — after [[CAD-116]]
- [ ] Animation of the study

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
