import { scriptApiTypes } from './script-api';

/**
 * What the MCP server offers besides tools (CAD-172): the command reference and the user guide as
 * resources, and prompts for common jobs.
 */

export interface Resource {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: string;
  readonly text: string;
}

const topics: Readonly<Record<string, string>> = {
  commands: 'Design commands and shorthands',
  sketch: 'Sketch entities and constraints',
  features: 'Features and parts (gears, screws, bearings …)',
  document: 'Components, materials, checks, appearance',
  assembly: 'Assembly commands, instances, joints, links, studies, exploded views',
  drawing: 'Drawing commands, sheets, views, annotations',
  scripts: 'The scripting API inside run_script, console scripts and plugin generators',
};

/** A guide page's title from its first heading, else its name. */
const titleOf = (name: string, text: string) => /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name.replace(/-/g, ' ');

/** The reference by topic (`cadence://reference/<topic>`) and the user guide's pages (`cadence://guide/<page>`). */
export function resourcesOf(reference: Readonly<Record<string, string>>, guide: Readonly<Record<string, string>>): Resource[] {
  const withScripts = { ...reference, scripts: scriptApiTypes };
  return [
    ...Object.entries(withScripts).map(([topic, text]) => ({
      uri: `cadence://reference/${topic}`,
      name: `reference-${topic}`,
      title: `Command reference: ${topic}`,
      description: `${topics[topic] ?? topic}, as TypeScript types with their documentation.`,
      mimeType: 'text/x-typescript',
      text,
    })),
    ...Object.entries(guide).map(([page, text]) => ({
      uri: `cadence://guide/${page}`,
      name: `guide-${page}`,
      title: `User guide: ${titleOf(page, text)}`,
      description: `The user guide's page "${titleOf(page, text)}".`,
      mimeType: 'text/markdown',
      text,
    })),
  ];
}

export interface PromptArgument {
  readonly name: string;
  readonly description: string;
  readonly required?: boolean;
}

export interface Prompt {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly PromptArgument[];
  /** The message the prompt gives, from its arguments. */
  text(args: Readonly<Record<string, string>>): string;
}

const optional = (value: string | undefined, text: (value: string) => string) => (value?.trim() ? text(value.trim()) : '');

/** Prompts for common jobs: a part from a sketch, a drawing of a part, an assembly of parts, parts by a script. */
export const prompts: readonly Prompt[] = [
  {
    name: 'part_from_sketch',
    title: 'A part from a sketch',
    description: 'Model a part: sketch its outline, extrude it, add holes and fillets, check and export it.',
    arguments: [
      { name: 'part', description: 'What to make, with its sizes, e.g. "a wall bracket for a 25 mm pipe, 4 mm thick, with two screw holes".', required: true },
      { name: 'process', description: 'How it is made: "print" (3D printing, the default) or "laser" (laser cutting).' },
      { name: 'format', description: 'The file to export: 3mf (default), stl, step; dxf for laser cutting.' },
    ],
    text: (args) => `Model ${args['part'] ?? 'the part'} in CADence.
1. create_project (or use a project from list_projects); a new project has an empty component.
2. Read cadence://reference/commands and cadence://reference/sketch if the commands are new to you.
3. edit_component: create-sketch on XY, then the outline with add-rectangle, add-circle or add-polygon; sizes may be parameters (add-parameter) so the part can change later.
4. edit_component: add-feature extrude with the outline's profile (the answer lists the profiles); holes as circles in the sketch, or hole features at sketch points.
5. get_component with a filter for the edges to round, then fillet or chamfer them.
6. render_picture (iso, and a view along the part) to look at it; fix what is wrong.
7. set-process ${args['process'] === 'laser' ? 'laser' : 'print'}, then check_component and fix what it reports.
8. export_component as ${args['format'] ?? (args['process'] === 'laser' ? 'dxf of the sketch' : '3mf')}, and say where the file is.`,
  },
  {
    name: 'drawing_of_part',
    title: 'A drawing of a part',
    description: 'A technical drawing of a component: views, dimensions, a title block, as PDF.',
    arguments: [
      { name: 'component', description: 'The component (id or name, from list_documents).', required: true },
      { name: 'project', description: 'Its project (id or name).' },
      { name: 'views', description: 'Which views: e.g. "front, top, right and iso" (the default), a section, details.' },
    ],
    text: (args) => `Draw ${args['component'] ?? 'the component'}${optional(args['project'], (p) => ` of the project ${p}`)} in CADence.
1. Read cadence://reference/drawing for the drawing commands.
2. create_document with kind "drawing" in its project; edit_drawing set-sheet (size and scale so the part fits) and set-title-block.
3. edit_drawing add-view for ${args['views'] ?? 'front, top, right and iso'} views, placed so they do not overlap (get_drawing tells their boxes).
4. get_drawing with anchors (by view, kind or extremes): dimension the overall sizes, then the holes (diameter, center marks, hole callouts) and their positions.
5. render_picture of the drawing to check it reads well; move views or annotations that crowd each other.
6. export_drawing as PDF, and say where it is.`,
  },
  {
    name: 'assembly_of_parts',
    title: 'An assembly of parts',
    description: 'Put components together with joints, check them for overlaps, and show how they move.',
    arguments: [
      { name: 'parts', description: 'The components and how they go together, e.g. "the base, the arm on its hinge, the lid on top".', required: true },
      { name: 'project', description: 'The project (id or name).' },
      { name: 'motion', description: 'How it moves, for a motion study, e.g. "the arm turns 90°".' },
    ],
    text: (args) => `Assemble ${args['parts'] ?? 'the parts'}${optional(args['project'], (p) => ` in the project ${p}`)} in CADence.
1. Read cadence://reference/assembly for the assembly commands.
2. create_document with kind "assembly"; edit_assembly insert-instance for each component (the first grounded).
3. get_component of each part for the faces the joints sit on; add-joint per connection (rigid, revolute, slider …); get_assembly tells joints that fail and why.
4. check_assembly for overlaps, and render_picture to look at it; fix joints and offsets.${optional(args['motion'], (m) => `\n5. add-study for the motion (${m}); check_assembly with the study for collisions; animate_study to show it.`)}
${args['motion'] ? '6' : '5'}. assembly_properties for the mass and the bill of materials.`,
  },
  {
    name: 'parts_by_script',
    title: 'Many parts by one script',
    description: 'Make a series of parts (sizes, variants) with one run_script instead of a call per step.',
    arguments: [
      { name: 'parts', description: 'What to make, e.g. "spacers 10 to 50 mm long in steps of 10, 8 mm bore".', required: true },
      { name: 'project', description: 'The project to make them in (a new one otherwise).' },
    ],
    text: (args) => `Make ${args['parts'] ?? 'the parts'} in CADence with one script.
1. Read cadence://reference/scripts (the API inside a script: every call is awaited) and cadence://reference/commands.
2. Model one of them first with edit_component to learn its commands and profile ids.
3. run_script with a loop: ${optional(args['project'], (p) => `in the project ${p} (cadence.project("${p}")), `)}cadence.projects.createDocument for each size, cadence.component(id), then run(...) the same commands with that size; return the ids and names.
4. The answer lists the documents made; render_picture one or two of them to check.
5. To make more later with other sizes, keep the script with the project: cadence.projects.setProjectScripts with parameters, and run it with run_script's project and generator.`,
  },
];
