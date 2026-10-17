import type { DrawingCommand } from '@core/managers/drawing';
import type { Cadence } from '../api';
import type { DrawingFilter } from '../drawing';
import { CadenceError } from '../results';
import { documentArg, number, object, point2, runAll, string, type Tool } from './schema';

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
        "A drawing as data: the sheet (size in mm), title block, views with their boxes on the sheet (and why one cannot be drawn), annotations, and the anchors annotations attach to: each view's points, circles (centre and radius) and lines (ends), by persistent name, where they are on the sheet. Filter the anchors by view, kind or a sheet point.",
      inputSchema: object(
        {
          document: documentArg,
          view: string('Only the anchors of this view.'),
          kind: { type: 'string', enum: ['point', 'circle', 'line'], description: 'Only anchors of this kind.' },
          near: point2('Only anchors within `within` mm of this sheet point [x, y].'),
          within: number('Distance for near, sheet mm (5 by default).'),
        },
        ['document'],
      ),
      run: async (args) => {
        const { document: _, ...filter } = args;
        return (await drawing(args)).summary(filter as DrawingFilter);
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
              'E.g. {"type":"add-view","view":{"id":"front","source":"<component id>","direction":"front","at":[120,100]}}, then a dimension between two anchors from get_drawing: {"type":"add-annotation","annotation":{"kind":"dimension","id":"w","type":"horizontal","anchors":[{"view":"front","kind":"point","name":"…"},{"view":"front","kind":"point","name":"…"}],"offset":10}}.',
          },
        },
        ['document', 'commands'],
      ),
      run: async (args) => {
        const script = await drawing(args);
        const before = await script.summary();
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
        const before = await script.summary();
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
