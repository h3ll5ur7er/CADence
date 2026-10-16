# Performance

How fast CADence is on large models, how it is measured, and what was done about it ([[CAD-94]], [[CAD-95]], [[Architecture/Decisions#ADR-42]]).

[TOC]

## Measuring

`npm run bench` runs the benchmarks in [[tools/benchmark/large-models.bench.ts]]. They take a few minutes and are not part of `npm test`. The core runs as it does for scripts: in Node, on one thread, with the same kernels as the app. Each case prints its timings and, at the end, a table like the one below.

| Case | What it is |
| --- | --- |
| Plate, 400 holes | A 305 × 305 mm sketch with 400 circles, extruded 4 mm: 806 faces, 104,000 triangles |
| Timeline, 60 items | A plate and 29 sketches with a boss each, joined one by one |
| Assembly, 200 washers | 200 instances of one component, inserted one by one |
| Strength, 60 × 30 × 3 plate | A thin plate with a hole, pulled at one end, at three element sizes |

Two numbers come from the browser: `e2e/performance.spec.ts` builds an assembly of 60 copies of a plate and counts the geometries on the graphics card.

## Results

Measured on a desktop PC (Windows, Node 24) on 2026-10-16.

| Case | Measure | Before | After |
| --- | --- | --- | --- |
| Plate, 400 holes | Sketch (401 curves) | out of memory (200 circles: 13.3 s) | 5.3 s |
| Plate, 400 holes | Extrude (build and mesh) | out of memory (100 holes: 1.9 s) | 4.6 s (100 holes: 0.86 s) |
| Plate, 400 holes | Thickness changed | — | 4.3 s |
| Plate, 400 holes | Mass properties | — | 0.16 s |
| Plate, 400 holes | Printability check | 12.9 s | 5.0 s |
| Plate, 400 holes | STL export | 6.6 s | 6.7 s (finer mesh than the view; the user's choice) |
| Timeline, 60 items | Building it | 3.2 s | 3.1 s |
| Timeline, 60 items | First sketch changed (all again) | 1.2 s | 1.2 s |
| Timeline, 60 items | Last feature changed (the rest reused) | — | 0.15 s |
| Assembly, 200 washers | Inserting one by one | 4.2 s | 3.9 s |
| Assembly, 200 washers | Opening it | 46 ms | 43 ms |
| Assembly, 200 washers | Interference check | 0.51 s | 0.49 s |
| Assembly, 200 washers | Software picture 800 × 600 | 0.39 s | 0.18 s |
| Strength, thin plate | 9,312 elements | 8.7 s | 1.6 s |
| Strength, thin plate | 31,464 elements | 51 s | 4.6 s |
| Browser, 60 instances | Geometries on the graphics card | 132 | 14 |

## What was slow, and why

- **Sketches with many separate shapes.** The constraint solver solved the whole sketch as one system. Its work grows with the cube of the system's size, so 400 circles ran out of WebAssembly memory. Finding regions also compared every curve with every other curve. Now:
  - independent groups (geometry joined by constraints, shared points or a generator) are solved one by one;
  - curves only intersect when their boxes meet;
  - loops are tested for nesting only when their boxes overlap.
- **Profiles with many holes.** Each hole was cut from the outline with replicad's general 2D boolean, and each cut compared all holes so far. The sketch engine already knows which loops are holes, so a profile is now built directly as one outline with its holes.
- **Listing faces and edges.** replicad's `shape.faces` and `shape.edges` compare each element with all earlier ones (`IsSame`), which is quadratic: on 806 faces that is millions of calls into WebAssembly. Our code now uses `facesOf` and `edgesOf` from Shape Access. They give the same elements in the same order, but compare only elements with equal hash codes. replicad's own mesher is native and was not affected.
- **The printability check** meshed the part twice as finely as the view. It now uses the view's tolerance, which is plenty for overhangs and wall thickness.
- **The strength check's solver** needed over a thousand steps on thin parts, because sweeps hardly touch their bending. A coarse correction now moves regions of the part as rigid bodies, so about 30 steps are enough.
- **Assemblies of many copies** uploaded each instance's triangles to the graphics card again. Drawings of the same body mesh now share one geometry, which is counted and freed with its last user.

## Rust and WebAssembly

[[CAD-95]] asked to move a hotspot to Rust where profiling shows a need. The strength check's solver was the candidate: it spends its time in tight loops over typed arrays.

The same algorithm in Rust, compiled to `wasm32-unknown-unknown` with full optimisation, ran the 9,312-element system in **6.2 s against 7.4 s** in TypeScript: 1.2 times as fast. Changing the algorithm made it **5 times** as fast in TypeScript. Every other hotspot above was algorithmic as well (quadratic loops, a too-fine mesh, a solve that should have been split).

So nothing was ported. A Rust build would add a toolchain to the web build and CI for a gain V8 nearly matches. The option stays open behind the engines' interfaces ([[Architecture/Decisions#ADR-8]]).

## Where to look next

- STL export at fine quality meshes the part again; that is the kernel's own (native) time.
- Building the 400-hole plate spends about 3 s meshing it for the view, also native. Meshing in a pool of workers could split it, at the price of a kernel per worker.
- An assembly still draws each instance on its own (one draw call per body). Instanced meshes would cut that for hundreds of copies, but picking and looks per instance would need work.
