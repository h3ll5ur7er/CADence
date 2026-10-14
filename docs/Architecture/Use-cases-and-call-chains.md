# Use cases and call chains

The architecture is validated by showing that every **core use case** is an interaction between the components of [[Architecture]] that follows the call rules. When a new requirement can be expressed this way, the design holds. When it cannot, the decomposition needs revisiting.

[TOC]

## Core use cases

| # | Use case | Components involved |
| --- | --- | --- |
| UC1 | Browse projects on start-up | Home → Project Manager → Project Access |
| UC2 | Create a component, sketch on a plane, extrude | Component editor → Design Manager → Parameter, Sketch, Modeling engines → Shape Access, Document Access |
| UC3 | Change a parameter and regenerate | Component editor → Design Manager → Parameter, Sketch, Modeling engines |
| UC4 | Export bodies as STL / STEP / OBJ / 3MF | Component editor → Design Manager → Interchange Engine → Shape Access; External File Access |
| UC5 | Export a sketch as DXF / SVG | Component editor → Design Manager → Interchange Engine; External File Access |
| UC6 | Import a STEP / STL / OBJ / DXF / SVG file | Home → Project Manager → External File Access, Asset Access, Interchange Engine, Document Access |
| UC7 | Build an assembly with a revolute joint and animate it | Assembly editor → Assembly Manager → Asset Access, Modeling, Kinematics engines; queued request to the Design Manager |
| UC8 | Validate a part for 3D printing or laser cutting | Component editor → Design Manager → Analysis Engine → Shape Access |

## UC1: Browse projects

```mermaid
sequenceDiagram
  actor U as User
  participant H as Home
  participant PM as Project Manager
  participant PA as Project Access
  U->>H: open app / navigate home
  H->>PM: listProjects()
  PM->>PA: enumerate()
  PA-->>PM: ProjectSummary[]
  PM-->>H: ProjectSummary[]
  H-->>U: project grid (or empty state with "New project")
```

## UC2: Sketch and extrude

```mermaid
sequenceDiagram
  actor U as User
  participant CE as Component editor
  participant DM as Design Manager
  participant PE as Parameter Engine
  participant SE as Sketch Engine
  participant ME as Modeling Engine
  participant SA as Shape Access
  participant DA as Document Access
  U->>CE: New sketch on XY, draw rectangle, dimension 40×20
  CE->>DM: execute(addSketch / editSketch ops)
  DM->>PE: evaluate(parameters)
  DM->>ME: resolvePlane(XY)
  DM->>SE: solve(sketch, values, plane)
  SE-->>DM: SolvedSketch (fully constrained, 1 profile)
  DM-->>CE: state$ (sketch geometry, DOF = 0)
  U->>CE: Extrude profile, distance = "height"
  CE->>DM: execute(addFeature extrude)
  DM->>ME: applyFeature(extrude, profile, values)
  ME->>SA: put(bodyKey, shape)
  ME-->>DM: FeatureResult (body key, topology map)
  DM->>ME: tessellate(bodyKeys)
  ME->>SA: get(bodyKey)
  ME-->>DM: MeshDTO[] (transferable)
  DM->>DA: store(document)  (debounced autosave)
  DM-->>CE: state$ (timeline, meshes)
```

## UC3: Change a parameter

The Design Manager owns the regeneration *sequence*. Engines skip items whose input hash has not changed.

```mermaid
sequenceDiagram
  participant CE as Component editor
  participant DM as Design Manager
  participant PE as Parameter Engine
  participant SE as Sketch Engine
  participant ME as Modeling Engine
  CE->>DM: execute(setParameter height = "2 * wall + 10 mm")
  DM->>PE: evaluate(parameters)
  PE-->>DM: values (or cycle / unit errors → command rejected)
  loop each timeline item up to the rollback marker
    alt sketch
      DM->>ME: resolvePlane(ref)
      DM->>SE: solve(sketch, values, plane)
    else feature
      DM->>ME: applyFeature(feature, inputs)
    end
  end
  DM->>ME: tessellate(changed bodies)
  DM-->>CE: state$ (meshes, per-item errors)
```

## UC4: Export bodies

```mermaid
sequenceDiagram
  participant CE as Component editor
  participant DM as Design Manager
  participant IE as Interchange Engine
  participant SA as Shape Access
  participant XA as External File Access
  CE->>DM: exportBodies('stl', {tolerance})
  DM->>IE: export(bodyKeys, 'stl', options)
  IE->>SA: get(bodyKeys)
  IE-->>DM: Uint8Array
  DM->>XA: deliver(bytes, "bracket.stl")
  XA-->>DM: done (download / native save dialog)
```

UC5 (sketch → DXF/SVG) uses the same chain. The engine receives the solved 2D geometry instead of body keys and does not need Shape Access.

## UC6: Import a file

```mermaid
sequenceDiagram
  participant H as Home
  participant PM as Project Manager
  participant XA as External File Access
  participant AA as Asset Access
  participant IE as Interchange Engine
  participant DA as Document Access
  H->>PM: importFile(projectId, fileRef)
  PM->>XA: read(fileRef)
  PM->>AA: keep(bytes, {name, format})
  PM->>IE: import(bytes, format)
  IE-->>PM: ImportResult (shapes / meshes / 2D entities, metadata)
  PM->>DA: store(imported document → asset id, metadata)
  PM-->>H: DocumentSummary
```

## UC7: Assembly with a revolute joint

```mermaid
sequenceDiagram
  participant AE as Assembly editor
  participant AM as Assembly Manager
  participant AA as Asset Access
  participant ME as Modeling Engine
  participant KE as Kinematics Engine
  participant DM as Design Manager
  AE->>AM: execute(insertInstance componentDocId)
  AM->>AA: latestResult(componentDocId)
  alt result missing or stale
    AM--)DM: queue RegenerateComponent(componentDocId)
    DM--)AM: event ComponentRegenerated
    AM->>AA: latestResult(componentDocId)
  end
  AM->>ME: restoreBodies(result, placement) + tessellate
  AE->>AM: execute(addJoint revolute, originA, originB)
  AM->>KE: solve(assembly, drivers)
  KE-->>AM: instance transforms
  AE->>AM: simulate(study)
  loop frames
    AM->>KE: step(state, dt)
    AM-->>AE: MotionFrame (transforms)
  end
```

The Assembly Manager consumes the component's **published result** and never repeats the Design Manager's regeneration workflow. When it needs a fresh result, it asks through a *queued* request, because manager-to-manager calls are never synchronous.

## UC8: Validate for 3D printing or laser cutting

```mermaid
sequenceDiagram
  actor U as User
  participant CE as Component editor
  participant DM as Design Manager
  participant AN as Analysis Engine
  participant SA as Shape Access
  U->>CE: open the check panel, choose a machine
  CE->>DM: execute(set-process)
  CE->>DM: validate()
  DM->>AN: validate({ named bodies, solved sketches }, document process)
  AN->>SA: get(body keys)
  AN-->>DM: Check[] (status, message, faces)
  DM-->>CE: ValidationReport
  CE-->>U: list of checks; faces of the focused check flagged in the viewport
```

The panel re-runs the validation after every change while it is open. Measuring follows the same chain: `measure(refs)` resolves the picked references in Shape Access and asks OCCT for areas, lengths, radii and the closest points.
