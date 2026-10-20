import type { TopologyRef } from '@core/contracts';
import type { PlacedRef } from '@core/managers/assembly';
import type { Cadence } from '../api';
import { CadenceError } from '../results';
import { documentArg, object, string, type Tool } from './schema';

/** What the app's measure, simulate, sketch status and repair panels show, for agents (CAD-124). */
export function modelTools(cadence: Cadence): Tool[] {
  const component = async (args: Record<string, unknown>) => {
    const document = await cadence.document(String(args['document']));
    if (document.kind !== 'component') throw new CadenceError('not-a-component', `${document.name} is not a component.`);
    return cadence.component(document.id);
  };
  return [
    {
      name: 'measure',
      description:
        'Area, length, radius, distance and angle of faces, edges and vertices: of a component ({"kind":"face","body":"<body>","name":"<face>"}), or of instances of an assembly (the same with "instance"), where they are. One element gives its size; two, their distance and angle.',
      inputSchema: object({ document: documentArg, refs: { type: 'array', items: { type: 'object' }, description: 'One or two faces, edges or vertices.' } }, ['document', 'refs']),
      run: async (args) => {
        const document = await cadence.document(String(args['document']));
        const refs = args['refs'] as readonly (TopologyRef & { instance?: string })[];
        if (document.kind === 'assembly') return (await cadence.assembly(document.id)).measure(refs as readonly PlacedRef[]);
        return (await component(args)).measure(refs);
      },
    },
    {
      name: 'simulate_component',
      description: "The strength check of the component's stored setup (set-simulation: fixed faces, loads, material): the largest stress (MPa), deflection (mm) and the safety factor.",
      inputSchema: object({ document: documentArg }, ['document']),
      run: async (args) => {
        // The surfaces and the mesh are for the app's colours: too long for an answer.
        const { bodies: _bodies, mesh: _mesh, ...result } = await (await component(args)).simulate();
        return result;
      },
    },
    {
      name: 'check_sketch',
      description:
        "What a sketch's relations and dimensions leave free (points that still move and which way, circles of open size), and the relations the sketcher would suggest; add those with the command add-suggested-constraints.",
      inputSchema: object({ document: documentArg, sketch: string('The sketch id.') }, ['document', 'sketch']),
      run: async (args) => {
        const script = await component(args);
        const sketch = String(args['sketch']);
        const [freedom, suggestions] = await Promise.all([script.freedom(sketch), script.suggestConstraints(sketch)]);
        return { fullyConstrained: freedom.points.length === 0 && freedom.radii.length === 0, ...freedom, suggestions };
      },
    },
    {
      name: 'broken_references',
      description: 'The faces and edges a timeline item refers to that are gone (after an earlier change), each with the faces or edges it could refer to instead, those of the same shape (kind, size, radius) first, then the nearest; fix them with edit-feature.',
      inputSchema: object({ document: documentArg, item: string('The timeline item (feature) id.') }, ['document', 'item']),
      run: async (args) => (await component(args)).brokenReferences(String(args['item'])),
    },
  ];
}
