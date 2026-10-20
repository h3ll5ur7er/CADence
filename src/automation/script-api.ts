/**
 * What a sandboxed script may use of the scripting API ([[Architecture/Decisions#ADR-60]]): one list
 * of members, from which come the stand-ins inside the sandbox, the calls the host answers, the
 * types the app's script console shows and the completions it offers. Runs in Node and the browser.
 */

/** The kinds of objects a script holds: the API itself, the project manager, and open documents. */
export type ScriptKind = 'cadence' | 'projects' | 'component' | 'assembly' | 'drawing';

export interface ScriptMember {
  readonly name: string;
  /** Parameters and result, as TypeScript (every result is a promise inside the sandbox). */
  readonly signature: string;
  readonly doc: string;
}

const m = (name: string, signature: string, doc: string): ScriptMember => ({ name, signature, doc });

export const scriptMembers: Readonly<Record<ScriptKind, readonly ScriptMember[]>> = {
  cadence: [
    m('project', '(idOrName: string): Promise<ProjectSummary>', 'A project by id or name.'),
    m('document', '(idOrName: string, project?: string): Promise<DocumentSummary>', 'A document by id, or by id or name within a project.'),
    m('component', '(documentId: string): Promise<Component>', 'A component, open for scripting.'),
    m('assembly', '(documentId: string): Promise<Assembly>', 'An assembly, open for scripting.'),
    m('drawing', '(documentId: string): Promise<Drawing>', 'A technical drawing, open for scripting.'),
    m('picture', '(documentId: string, options?: PictureOptions): Promise<string>', 'A PNG of a component, an assembly or a drawing, as base64.'),
    m('exportImported', "(documentId: string, format: string, options?: { to?: string }): Promise<string>", 'An imported file in another format; the path of the file.'),
    m('settled', '(): Promise<void>', 'Resolves once the work started is done (components rebuilt, results written).'),
  ],
  projects: [
    m('listProjects', '(): Promise<ProjectSummary[]>', 'The projects, most recently changed first.'),
    m('findProject', '(id: string): Promise<ProjectSummary | undefined>', 'A project by id.'),
    m('createProject', '(name: string): Promise<Result<{ project: ProjectSummary; firstDocument: DocumentSummary }>>', 'A new project with an empty component.'),
    m('renameProject', '(id: string, name: string): Promise<Result<void>>', 'Renames a project.'),
    m('deleteProject', '(id: string): Promise<void>', 'Deletes a project.'),
    m('setProjectParameters', '(id: string, parameters: { id: string; name: string; expression: string }[]): Promise<Result<void>>', 'Parameters every component of the project can use.'),
    m('listDocuments', '(projectId: string): Promise<DocumentSummary[]>', "A project's documents."),
    m('findDocument', '(id: string): Promise<DocumentSummary | undefined>', 'A document by id.'),
    m('createDocument', "(projectId: string, kind: 'component' | 'assembly' | 'drawing', name?: string): Promise<Result<DocumentSummary>>", 'A new, empty document.'),
    m('renameDocument', '(id: string, name: string): Promise<Result<void>>', 'Renames a document.'),
    m('deleteDocument', '(id: string): Promise<void>', 'Deletes a document.'),
    m('duplicateDocument', '(id: string): Promise<Result<DocumentSummary>>', 'A copy of a document in its project.'),
    m('duplicateProject', '(id: string): Promise<Result<ProjectSummary>>', 'A copy of a project.'),
    m('recordVersion', '(id: string, message?: string): Promise<void>', 'Records the project as a version now.'),
    m('projectHistory', '(id: string): Promise<Version[]>', "The project's versions, newest first."),
    m('documentHistory', '(id: string): Promise<Version[]>', 'The versions in which a document changed.'),
    m('restoreDocument', '(id: string, version: string): Promise<Result<void>>', 'A document as it was in a version.'),
    m('nameVersion', '(id: string, name: string, version?: string): Promise<Result<void>>', 'Names a version.'),
    m('setProjectScripts', '(id: string, scripts: ProjectScript[]): Promise<Result<void>>', 'The scripts kept with the project.'),
    m('installPlugin', '(id: string, source: string): Promise<Result<ProjectPlugin>>', 'Installs a plugin (its source) into the project.'),
    m('removePlugin', '(id: string, pluginId: string): Promise<Result<void>>', 'Removes a plugin from the project.'),
  ],
  component: [
    m('run', '(...commands: Command[]): Promise<void>', 'Runs design commands in order; throws at the first refused one.'),
    m('summary', '(filter?: SummaryFilter): Promise<ComponentSummary>', 'The component as data: parameters, timeline, sketches with profiles, bodies with faces and edges.'),
    m('changes', '(before: ComponentSummary): Promise<ComponentChanges>', 'What changed since an earlier summary.'),
    m('properties', '(): Promise<BodyProperties[]>', 'Volume, area, mass, centre of mass and box of each body.'),
    m('validate', '(): Promise<ValidationReport>', 'The checks of its manufacturing profile.'),
    m('measure', '(refs: TopologyRef[]): Promise<Measurement>', 'Sizes, distances and angles of faces, edges and vertices.'),
    m('simulate', '(): Promise<SimulationResult>', 'The strength check of the stored setup.'),
    m('freedom', '(sketchId: string): Promise<SketchFreedom>', 'What a sketch leaves free.'),
    m('suggestConstraints', '(sketchId: string, idPrefix?: string): Promise<SketchConstraint[]>', 'Relations that would fully define a sketch.'),
    m('brokenReferences', '(itemId: string): Promise<BrokenReference[]>', 'References a feature lost, with candidates.'),
    m('export', "(format: 'step' | 'stl' | 'obj' | '3mf', options?: { to?: string }): Promise<string>", 'Writes the bodies to a file; its path.'),
    m('exportSketch', "(sketchId: string, format: 'dxf' | 'svg', options?: { to?: string }): Promise<string>", 'Writes a sketch to a file; its path.'),
    m('exportFlatPattern', "(format: 'dxf' | 'svg', options?: { to?: string }): Promise<string>", 'Writes the flat pattern of a sheet metal part; its path.'),
    m('exportWith', '(plugin: string, exporter: string, options?: { to?: string }): Promise<string>', "Writes the bodies with a plugin's exporter; its path."),
    m('exportConfigurations', '(options?: { to?: string }): Promise<string>', 'Writes the configuration table (CSV); its path.'),
    m('exportViewer', '(options?: { to?: string }): Promise<string>', 'Writes an HTML viewer; its path.'),
    m('picture', '(options?: PictureOptions): Promise<string>', 'A PNG of the component, as base64.'),
    m('undo', '(): Promise<void>', 'Undoes the last change.'),
    m('redo', '(): Promise<void>', 'Redoes the last undone change.'),
  ],
  assembly: [
    m('run', '(...commands: AssemblyCommand[]): Promise<void>', 'Runs assembly commands in order; throws at the first refused one.'),
    m('summary', '(): Promise<AssemblySummary>', 'Instances, joints, links, patterns, studies and exploded views.'),
    m('changes', '(before: AssemblySummary): Promise<AssemblyChanges>', 'What changed since an earlier summary.'),
    m('interference', '(): Promise<unknown>', 'Instances whose solids overlap.'),
    m('collisions', '(study: string, fps?: number): Promise<CollisionReport>', 'Where instances hit while a study plays.'),
    m('measure', '(refs: PlacedRef[]): Promise<Measurement>', 'Sizes, distances and angles of instances.'),
    m('properties', '(): Promise<unknown>', 'Mass, volume and centre of mass.'),
    m('billOfMaterials', '(): Promise<BomLine[]>', 'Components, counts and materials.'),
    m('picture', '(options?: AssemblyPictureOptions): Promise<string>', 'A PNG of the assembly, as base64.'),
    m('export', "(format: 'step' | '3mf' | 'stl' | 'obj', options?: { to?: string }): Promise<string>", 'Writes the assembly to a file; its path.'),
    m('exportBillOfMaterials', '(options?: { to?: string }): Promise<string>', 'Writes the bill of materials (CSV); its path.'),
    m('exportViewer', '(options?: { to?: string }): Promise<string>', 'Writes an HTML viewer; its path.'),
    m('exportInstructions', '(explodedView: string, options?: { to?: string }): Promise<string>', 'Writes build instructions (PDF); its path.'),
    m('undo', '(): Promise<void>', 'Undoes the last change.'),
    m('redo', '(): Promise<void>', 'Redoes the last undone change.'),
  ],
  drawing: [
    m('run', '(...commands: DrawingCommand[]): Promise<void>', 'Runs drawing commands in order; throws at the first refused one.'),
    m('summary', '(filter?: DrawingFilter): Promise<DrawingSummary>', 'The sheet, its views, annotations and anchors.'),
    m('changes', '(before: DrawingSummary): Promise<DrawingChanges>', 'What changed since an earlier summary.'),
    m('picture', '(options?: { width?: number; view?: string }): Promise<string>', 'A PNG of the sheet, as base64.'),
    m('export', "(format: 'pdf' | 'dxf', options?: { to?: string }): Promise<string>", 'Writes the sheet to a file; its path.'),
    m('undo', '(): Promise<void>', 'Undoes the last change.'),
    m('redo', '(): Promise<void>', 'Redoes the last undone change.'),
  ],
};

const typeNames: Readonly<Record<ScriptKind, string>> = { cadence: 'Cadence', projects: 'Projects', component: 'Component', assembly: 'Assembly', drawing: 'Drawing' };

/** The API inside the sandbox as TypeScript declarations, for people and agents writing scripts. */
export const scriptApiTypes = `// The scripting API inside a sandboxed script (run_script, the app's script console, plugin generators).
// Every call returns a promise: await it. Command types: command_reference (commands, features, assembly, drawing).
// Results of the project manager are { ok: true, value } or { ok: false, error: { code, message } }.

/** The API. */
declare const cadence: Cadence & { readonly projects: Projects };
/** A script's parameters (the console and generators) and arguments (run_script). */
declare const params: Record<string, number | string>;
declare const args: unknown;

${(Object.keys(scriptMembers) as ScriptKind[])
  .map((kind) => `interface ${typeNames[kind]} {\n${scriptMembers[kind].map((member) => `  /** ${member.doc} */\n  ${member.name}${member.signature};`).join('\n')}\n}`)
  .join('\n\n')}
`;

/** The members a completion offers after `<word>.`: the API, the project manager, else any open document's. */
export function completionsAfter(word: string): readonly ScriptMember[] {
  if (word === 'cadence') return [...scriptMembers.cadence, m('projects', ': Projects', 'The project manager: projects, documents, versions, scripts and plugins.')];
  if (word === 'projects') return scriptMembers.projects;
  const seen = new Set<string>();
  return [...scriptMembers.component, ...scriptMembers.assembly, ...scriptMembers.drawing].filter((member) => !seen.has(member.name) && seen.add(member.name));
}
