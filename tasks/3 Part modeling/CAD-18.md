---
id: CAD-18
title: Undo, redo and autosave
type: feature
status: done
priority: high
---

All edits are commands ([[Architecture/Decisions#ADR-10]]).

- [x] Command history with undo/redo in Design sessions (state snapshots); Ctrl+Z, Ctrl+Y
- [x] Every accepted command is saved immediately through Document Access, so no dirty state exists
- [ ] Assembly sessions: with [[CAD-22]]
