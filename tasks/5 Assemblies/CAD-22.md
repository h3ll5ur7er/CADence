---
id: CAD-22
title: Assembly Manager and instances
type: feature
status: done
priority: high
---

Assembly Manager ([[src/core/managers/assembly/assembly-manager.ts]]) and the assembly editor ([[User-guide/Assemblies]]).

- [x] Assembly session with commands; insert and remove component instances
- [x] Publish component results (B-rep, names) from the Design Manager (moved here from [[CAD-14]]); stamped with the component's `modifiedAt` ([[Architecture/Decisions#ADR-11]])
- [x] Restore instances from published component results; queue `regenerateComponent` to the Design Manager when missing or stale
- [x] Free move (position fields), ground instance; instance tree
- [x] React to queued `documentRenamed` / `documentDeleted` events
- [x] Schema version 2: assemblies get motion studies (migration)

Not done: moving free instances by dragging in the 3D view (they move by their position fields).
