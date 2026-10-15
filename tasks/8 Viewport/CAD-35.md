---
id: CAD-35
title: Display of bodies and instances, vertex picking
type: feature
status: done
priority: medium
---

- [x] Show and hide bodies and instances (stored in the document)
- [x] Colour and transparency per body and per instance
- [x] Pick vertices for measuring and as references

Appearances are document state with undoable commands; an instance's look overrides its component's. Vertices are named by their edges (`v:…`) and resolve in the kernel for measuring ([[src/core/access/shape/lookup.ts]]); the viewport finds them on screen.
