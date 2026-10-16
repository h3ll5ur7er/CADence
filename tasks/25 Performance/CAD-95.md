---
id: CAD-95
title: Rust/WASM where profiling shows a need
type: feature
status: done
priority: low
---

Move a proven hotspot to Rust/WASM behind its engine interface (ADR-8).

- [x] Profile after CAD-94; port a hotspot only if it pays

Not ported: the best candidate, the strength check's solver, ran 1.2 times as fast in Rust/WebAssembly as in TypeScript, while a better algorithm made it 5 times as fast. Every hotspot found was algorithmic ([[Architecture/Performance#Rust and WebAssembly]], [[Architecture/Decisions#ADR-42]]).
