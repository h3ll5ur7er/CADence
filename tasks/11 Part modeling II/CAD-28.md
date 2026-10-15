---
id: CAD-28
title: Timeline: reorder and roll back
type: feature
status: done
priority: medium
---

Change the order of timeline items by dragging, and roll the model back to an earlier item to insert features there.

- [x] `reorder-item` and `roll-to` commands; refuse orders that break references (an item before what it uses; a moved item that fails)
- [x] Rollback marker in the timeline UI (drag it or use the arrow keys); new features insert at the marker; items reorder by dragging or Alt+arrow keys
