import type { DrawingCommand } from '@core/managers/drawing';
import type { Cadence } from '../api';
import type { DrawingFilter } from '../drawing';
import { CadenceError } from '../results';
import { documentArg, number, object, point2, runAll, string, strings, type Tool } from './schema';

/** A drawing command as an agent may write it: a view without `hidden` shows no hidden edges. */
function completed(command: DrawingCommand): DrawingCommand {
  if (command.type !== 'add-view' && command.type !== 'edit-view') return command;
  return { ...command, view: { ...command.view, hidden: command.view.hidden ?? false } };
}

/** Technical drawings for agents (CAD-123): look at a sheet, place views and annotations, picture and export it. */
export function drawingTools(cadence: Cadence): Tool[] {
  const drawing = async (args: Record<string, unknown>) => {
    const document = await cadence.document(String(args['document']));
    if (document.kind !== 'drawing') throw new CadenceError('not-a-drawing', `${document.name} is not a drawing.`);
    return cadence.drawing(document.id);
  };
  return [
    {
      name: 'get_drawing',
      description:
        "A drawing as data: the sheet (size in mm), title block, views with their boxes on the sheet (why one cannot be drawn, how it was drawn when not exactly), annotations, and how many anchors each view offers. Anchors (what annotations attach to: points, circles, lines, one per place, with where they are on the sheet and in the model) are listed when asked for: by view, kind, a sheet point, a circle diameter, or the views' outermost points (extremes); only those the view shows unless hidden. Each has a short `ref`: attach annotations with {\"view\":\"front\",\"ref\":\"p1k9zq\"}.",
      inputSchema: object(
        {
          document: documentArg,
          only: strings('Only these parts: sheet (and title block), views, annotations, anchors.'),
          view: string('Anchors of this view.'),
          kind: { type: 'string', enum: ['point', 'circle', 'line'], description: 'Anchors of this kind (circles largest first).' },
          near: point2('Anchors within `within` mm of this sheet point [x, y].'),
          within: number('Distance for near, sheet mm (5 by default).'),
          diameter: number('Circles of this diameter, model mm.'),
          extremes: { type: 'boolean', description: "The views' outermost points seen (left, right, top, bottom), for overall dimensions." },
          hidden: { type: 'boolean', description: 'Also anchors the view does not show (hidden, with hidden lines off).' },
          names: { type: 'boolean', description: 'Persistent names too (long), in anchors and annotations.' },
        },
        ['document'],
      ),
      run: async (args) => {
        const { document: _, ...filter } = args as Record<string, unknown> & DrawingFilter;
        // Anchors only when asked for: views can offer thousands (CAD-128).
        const asked = ['only', 'view', 'kind', 'near', 'diameter', 'extremes'].some((key) => key in filter);
        return (await drawing(args)).summary(asked ? filter : { ...filter, only: ['sheet', 'views', 'annotations'] });
      },
    },
    {
      name: 'edit_drawing',
      description:
        'Runs drawing commands in order (set-sheet, set-title-block, add-view, edit-view, remove-view, add-annotation, edit-annotation, remove-annotation; command_reference topic "drawing"), then answers with what changed, where new views sit on the sheet, views that cannot be drawn and annotations whose geometry is gone. Sheet coordinates are mm from the bottom left. Stops at the first refused command; the ones before it stay applied.',
      inputSchema: object(
        {
          document: documentArg,
          commands: {
            type: 'array',
            items: { type: 'object' },
            description:
              'E.g. {"type":"add-view","view":{"id":"front","source":"<component id>","direction":"front","at":[120,100]}} (with "configuration":"<id>" for a configuration of a component), then a dimension between two anchors from get_drawing, by ref: {"type":"add-annotation","annotation":{"kind":"dimension","id":"w","type":"horizontal","anchors":[{"view":"front","ref":"p…"},{"view":"front","ref":"c…"}],"offset":10}}. Lengths go between points or circle centres; a diameter takes a circle or two outlines of a cylinder (lines s:…); radius and diameter take an "angle" (degrees) for their leader.',
          },
        },
        ['document', 'commands'],
      ),
      run: async (args) => {
        const script = await drawing(args);
        const before = await script.summary({ names: true, only: ['sheet', 'views', 'annotations'] });
        await runAll(args['commands'] as DrawingCommand[], (command) => script.run(completed(command)));
        return script.changes(before);
      },
    },
    {
      name: 'undo_drawing',
      description: 'Undoes the last change of a drawing (or redoes it, with redo); answers with what changed.',
      inputSchema: object({ document: documentArg, redo: { type: 'boolean', description: 'Redo instead.' } }, ['document']),
      run: async (args) => {
        const script = await drawing(args);
        const before = await script.summary({ names: true, only: ['sheet', 'views', 'annotations'] });
        await (args['redo'] ? script.redo() : script.undo());
        return script.changes(before);
      },
    },
    {
      name: 'export_drawing',
      description: 'Writes a drawing as PDF (the sheet at its size) or DXF (mm, lines and texts on layers by style). Returns the path.',
      inputSchema: object({ document: documentArg, format: { type: 'string', enum: ['pdf', 'dxf'] }, path: string('Where to write the file (default: the exports folder).') }, ['document', 'format']),
      run: async (args) => (await drawing(args)).export(args['format'] as 'pdf' | 'dxf', args['path'] === undefined ? {} : { to: String(args['path']) }),
    },
  ];
}
