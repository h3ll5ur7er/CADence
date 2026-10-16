---
id: CAD-97
title: MCP tools for assemblies
type: feature
status: todo
priority: high
labels: [mcp, assemblies, found-by-CAD-96]
---

The MCP server only edits components: an agent can create an empty assembly (`create_document`) and take a picture of it, but cannot insert instances, add joints, links, patterns, motion studies or exploded views, nor read an assembly back. The scripting API has `cadence.assembly(id).run(...)` with every `AssemblyCommand`, so the core is ready; the MCP server lacks the tools. Found while planning [[CAD-96]], whose assembly is blocked by it.

- [ ] `edit_assembly`: runs `AssemblyCommand`s in order, like `edit_component`, and returns the assembly
- [ ] `get_assembly`: instances, poses, joints with their values and errors (`jointErrors`), links, patterns, studies, exploded views
- [ ] `undo_assembly`
- [ ] Assembly checks: interference, collisions of a study, mass properties, bill of materials
- [ ] `export_assembly` (STEP, 3MF, STL, OBJ)
- [ ] `command_reference` includes `AssemblyCommand` and the assembly contracts (`Instance`, `Joint`, `JointOrigin`, `MotionLink`, `MotionStudy`, `ExplodedView`, `InstancePattern`)
- [ ] The server instructions explain how to place joints for an agent (refs or origins with offsets, flips)
