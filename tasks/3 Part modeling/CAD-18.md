---
id: CAD-18
title: Undo, redo and autosave
type: feature
status: todo
priority: high
---

All edits are commands ([[Architecture/Decisions#ADR-10]]).

- [ ] Command journal with undo/redo in Design and Assembly sessions
- [ ] Debounced autosave through Document Access; dirty indicator
- [ ] Keyboard shortcuts

Already done in [[CAD-9]]: command history with undo/redo (state snapshots) and saving after every accepted command in the Design Manager, with Ctrl+Z / Ctrl+Y. What remains: a dirty indicator if saving becomes deferred, and the same for Assembly sessions.
