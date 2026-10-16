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

**Status (2026-10-16): unblocked.** All findings ([[CAD-97]] to [[CAD-108]]) are done in phase 26; the ring gear and the assembly can be built now. All other parts are modelled in the project *Magnum Opus R-9 radial engine*, and regenerate without errors with phase 26 (some face and body names changed, see [[Magnum opus#Status]]).

## Parts (components, through `edit_component`)

- [x] Crankcase, front and rear half as configurations of one component (nine-sided instead of a round drum with pads, because of [[CAD-103]])
- [x] Crankshaft with counterweight
- [x] Master rod with eight knuckle pins (circular pattern of new bodies)
- [x] Link rod
- [x] Piston and wrist pin
- [x] Cylinder barrel (eleven fins)
- [x] Cylinder head (fins, rocker boxes, ports, plug bosses)
- [x] Spark plug (modelled M10 thread, see [[CAD-105]]), pushrod, intake pipe and exhaust stub (sweeps)
- [x] Cam drive: crank gear 48T, lay gear 60T/12T, cam ring with two five-lobe tracks and a 96T gear
- [x] Reduction gear: sun 24T, planet 18T, planet carrier with propeller shaft
- [ ] Ring gear 60T (internal) — blocked by [[CAD-98]]
- [x] Nose case with nine tappet guides
- [x] Propeller blade (loft through five twisted airfoil sections; round shank extruded separately because of [[CAD-106]]), hub and spinner
- [x] Rear case with nine intake bosses, magneto, display stand

## Assembly — blocked by [[CAD-97]]

- [ ] Instances, grounded barrels, joints (nine slider-crank loops)
- [ ] Gear links: cam drive (1/10, same direction), propeller reduction (2/7) and planets; valve train needs [[CAD-99]]
- [ ] Instance patterns for heads, plugs, pushrods and pipes; blades as a circular pattern on the turning hub
- [ ] Motion study and exploded view, checked in pictures ([[CAD-100]])

## Findings

- [[CAD-97]] MCP tools for assemblies (missing, blocks the assembly)
- [[CAD-98]] Internal (ring) gears (missing, blocks the reduction gear)
- [[CAD-99]] Cam joints (missing, blocks the valve train's motion)
- [[CAD-100]] Pictures of exploded views and motion for agents (missing)
- [[CAD-101]] Fillet and chamfer faces named after the first edge
- [[CAD-102]] Leaner MCP answers (gears overflow the client)
- [[CAD-103]] Joining a pad onto a revolved body fails for some sizes
- [[CAD-104]] Face names on shared surfaces, and `~n` that renumber
- [[CAD-105]] A modelled thread ending at a shoulder cuts nothing
- [[CAD-106]] A loft from a circle into splines twists
- [[CAD-107]] Gear teeth are polygons (23 faces per tooth)
- [[CAD-108]] Agent papercuts in the MCP server and the sketcher
