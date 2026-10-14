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
  participant E as Editor (documents panel, imported viewer)
  participant PM as Project Manager
  participant AA as Asset Access
  participant IE as Interchange Engine
  participant DA as Document Access
  participant XA as External File Access
  E->>PM: importFile(projectId, { name, bytes })
  PM->>AA: keep(original)
  PM->>DA: store(imported document → asset id, format)
  PM-->>E: DocumentSummary
  E->>PM: previewImported(document)
  PM->>AA: fetch(original)
  PM->>IE: readMesh or readDrawing(bytes, format)
  IE-->>PM: meshes and statistics, or sketch entities
  E->>PM: exportImported(document, other format)
  PM->>IE: convert(bytes, from, to)
  PM->>XA: deliver(converted)
```

The client picks the file (a picker or drag and drop needs a user gesture) and hands its name and bytes over. Components use the file through an **Insert body** feature (the Design Manager reads it with `readSolids`) and sketches through `insertDrawing`; assemblies insert it as an instance.

## UC7: Assembly with a revolute joint

```mermaid
sequenceDiagram
  participant AE as Assembly editor
  participant AM as Assembly Manager
  participant AA as Asset Access
  participant ME as Modeling Engine
  participant KE as Kinematics Engine
  participant DM as Design Manager
  AE->>AM: execute(insert-instance component)
  AM->>AA: latestResult(component)
  alt result missing or stale
    AM--)DM: queue regenerateComponent(component)
    DM->>AA: publishResult(snapshot)
    DM--)AM: event componentRegenerated
    AM->>AA: latestResult(component)
  end
  AM->>ME: restore(result) + tessellate
  AE->>AM: execute(add-joint revolute, rim A, rim B)
  AM->>ME: frameOf(bodies, ref) for each side
  AM->>KE: solve(instances, joints, driven)
  KE-->>AM: poses, solved values
  AE->>AM: motion(study, 30 fps)
  AM->>KE: simulate(model, study, fps)
  KE-->>AM: frames
  AM-->>AE: MotionFrame[] (played and recorded by the editor)
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
