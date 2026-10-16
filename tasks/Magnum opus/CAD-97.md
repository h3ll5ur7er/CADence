---
id: CAD-97
title: MCP tools for assemblies
type: feature
status: done
priority: high
labels: [mcp, assemblies, found-by-CAD-96]
---

The MCP server only edits components: an agent can create an empty assembly (`create_document`) and take a picture of it, but cannot insert instances, add joints, links, patterns, motion studies or exploded views, nor read an assembly back. The scripting API has `cadence.assembly(id).run(...)` with every `AssemblyCommand`, so the core is ready; the MCP server lacks the tools. Found while planning [[CAD-96]], whose assembly is blocked by it.

- [x] `edit_assembly`: runs `AssemblyCommand`s in order, like `edit_component`, and returns the assembly
- [x] `get_assembly`: instances, poses, joints with their values and errors (`jointErrors`), links, patterns, studies, exploded views
- [x] `undo_assembly`
- [x] Assembly checks: interference, collisions of a study, mass properties, bill of materials
- [x] `export_assembly` (STEP, 3MF, STL, OBJ)
- [x] `command_reference` includes `AssemblyCommand` and the assembly contracts (`Instance`, `Joint`, `JointOrigin`, `MotionLink`, `MotionStudy`, `ExplodedView`, `InstancePattern`)
- [x] The server instructions explain how to place joints for an agent (refs or origins with offsets, flips)

**Done (phase 26).** The tools are `get_assembly`, `edit_assembly`, `undo_assembly`, `check_assembly` (interference now, or collisions of a study), `assembly_properties` (mass and the bill of materials) and `export_assembly`. Edits answer with what changed and which joints fail; assembly sessions stay open between calls. [[Architecture/Decisions#ADR-45]], [[User guide/Automation#AI agents (MCP)]].
