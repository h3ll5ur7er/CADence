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

**Status (2026-10-16, round 2): unblocked again.** All round 2 findings ([[CAD-104]], [[CAD-109]] to [[CAD-115]]) are done in phase 27; the joints with `flip: true` on tappets 5–8 need their flips taken out ([[CAD-112]]). Before: Phase 26 fixed every round-1 finding except one case of [[CAD-104]] (reopened). All parts exist, the assembly *Radial engine* is built and solves, but no picture or animation of it can be taken ([[CAD-109]]) and the exploded view cannot include pattern copies ([[CAD-110]]). Pictures focused on a few instances work; in them the propeller shows that pattern copies stand still in the study ([[CAD-115]]).

## Parts (components, through `edit_component`)

- [x] Crankcase, front and rear half as configurations of one component (nine-sided; a round drum with pads works now too, [[CAD-103]])
- [x] Crankshaft with counterweight
- [x] Master rod with eight knuckle pins (circular pattern of new bodies)
- [x] Link rod
- [x] Piston and wrist pin
- [x] Cylinder barrel (eleven fins)
- [x] Cylinder head (fins, rocker boxes outboard for the pushrods, ports, plug bosses)
- [x] Spark plug (modelled M10 thread), pushrod, tappet, intake pipe and exhaust stub (sweeps)
- [x] Cam drive: crank gear 48T, lay gear 60T/12T, cam ring with two five-lobe tracks and a 96T gear
- [x] Reduction gear: sun 24T, planet 18T, ring gear 60T (internal, [[CAD-98]]), planet carrier with propeller shaft
- [x] Nose case with nine tappet guides
- [x] Propeller blade (loft from a round root through five twisted airfoil sections, [[CAD-106]]), hub and spinner
- [x] Rear case with nine intake bosses, magneto, display stand

## Assembly *Radial engine* (through `edit_assembly`)

- [x] 71 instances: grounded cases, stand, ring gear and nine barrels; crankshaft, master rod, eight link rods, nine pistons and wrist pins, cam ring, lay gear, nine tappets, carrier, planets, hub, spinner, blade
- [x] 57 joints, nine closed slider-crank loops through the master rod (cylindrical piston joints); solved at 0° and 90° of crank angle, values match the hand-computed kinematics
- [x] Links: lay gear −48/60, cam ring −12/96 (cam at 1/10), carrier 2/7, planets −20/21, nine cam followers (tappets) with per-cylinder lobe profiles ([[CAD-99]])
- [x] Patterns: heads, exhaust, intake, two plugs and pushrod ×9; blades ×3 on the turning hub (50 copies)
- [x] Motion study *Running at 60 rpm* (constant crank speed, 4 s)
- [x] Mass, bill of materials, interference check
- [ ] Collision check of the study — timed out after 30 minutes ([[CAD-114]])
- [ ] Pictures and the animation of the study — blocked by [[CAD-109]] (focused pictures work) and [[CAD-115]]
- [ ] Exploded view with every cylinder's parts outwards — blocked by [[CAD-110]]
- [ ] Pushrods following the tappets — needs [[CAD-113]]
- [ ] Fix my own design interferences the check found (see [[Magnum opus#Status]])

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
