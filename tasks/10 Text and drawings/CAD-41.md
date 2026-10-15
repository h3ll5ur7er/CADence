---
id: CAD-41
title: Text: sketch text, text on faces, text in imported drawings
type: feature
status: done
priority: medium
---

Text as outlines from a bundled open font.

- [x] Font outlines (a bundled open-licensed font, credited): Inter regular and bold (SIL OFL), read with opentype.js (MIT); credits listed for the About dialog in [[Open points]]
- [x] Sketch text tool: text, size, weight, angle, placement; becomes profiles (letters selected for extrude, their counters not)
- [x] Text on faces, embossed or engraved (sketch on the face, extrude or cut)
- [x] SVG `<text>` and DXF `TEXT`/`MTEXT` imported as editable text, written as outlines when converted

One font family, two weights; no kerning (Inter's GPOS lookup is not readable by opentype.js). Decision: [[Architecture/Decisions#ADR-26]]. Journey: [[e2e/text-and-drawings.spec.ts]] (evidence 42–44).
