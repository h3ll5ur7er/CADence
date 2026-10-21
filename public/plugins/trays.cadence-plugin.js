// Trays: a sample CADence plugin (docs/User-guide/Automation.md#plugins).
// A plugin is one JavaScript file whose body returns the plugin. It runs in CADence's sandbox:
// no files, no network, only what CADence hands it.

/** A rectangle with rounded corners, counter-clockwise, centred on (0, 0). */
function roundedRectangle(width, depth, radius) {
  const r = Math.max(0, Math.min(radius, width / 2 - 0.01, depth / 2 - 0.01));
  const corners = [
    [width / 2 - r, depth / 2 - r, 0],
    [-width / 2 + r, depth / 2 - r, 90],
    [-width / 2 + r, -depth / 2 + r, 180],
    [width / 2 - r, -depth / 2 + r, 270],
  ];
  const points = [];
  for (const [x, y, start] of corners) {
    if (r === 0) {
      points.push([x, y]);
      continue;
    }
    for (let step = 0; step <= 6; step++) {
      const angle = ((start + step * 15) * Math.PI) / 180;
      points.push([x + r * Math.cos(angle), y + r * Math.sin(angle)]);
    }
  }
  return points;
}

return {
  id: 'cadence.trays',
  name: 'Trays',
  version: '1.0.0',
  cadence: 1,
  features: {
    tray: {
      label: 'Tray',
      parameters: [
        { name: 'width', label: 'Width', default: '60 mm', kind: 'length' },
        { name: 'depth', label: 'Depth', default: '40 mm', kind: 'length' },
        { name: 'height', label: 'Height', default: '20 mm', kind: 'length' },
        { name: 'wall', label: 'Wall', default: '2 mm', kind: 'length' },
        { name: 'corner', label: 'Corner radius', default: '4 mm', kind: 'length' },
      ],
      // Lengths come in mm. A floor as thick as the wall, and walls around it.
      build({ width, depth, height, wall, corner }) {
        if (wall * 2 >= Math.min(width, depth)) throw new Error('The walls are thicker than half the tray.');
        if (height <= wall) throw new Error('The tray must be higher than its floor.');
        const outer = roundedRectangle(width, depth, corner);
        const inner = roundedRectangle(width - 2 * wall, depth - 2 * wall, corner - wall).reverse();
        return [
          { outline: outer, height: wall },
          { outline: outer, holes: [inner], z: wall, height: height - wall },
        ];
      },
    },
  },
  generators: {
    set: {
      label: 'Set of trays',
      parameters: [
        { name: 'count', label: 'How many', default: '3', kind: 'number' },
        { name: 'width', label: 'Width of the first', default: '40 mm', kind: 'length' },
        { name: 'step', label: 'Each one wider by', default: '20 mm', kind: 'length' },
      ],
      // Components of the project, each with a tray feature that stays editable.
      async run(cadence, { count, width, step }, { project }) {
        const made = [];
        for (let i = 0; i < count; i++) {
          const created = await cadence.projects.createDocument(project.id, 'component', `Tray ${width + i * step} mm`);
          if (!created.ok) throw new Error(created.error.message);
          const tray = await cadence.component(created.value.id);
          await tray.run({
            type: 'add-feature',
            feature: {
              type: 'plugin', id: 'tray', name: 'Tray', suppressed: false, plugin: 'cadence.trays', version: '1.0.0', feature: 'tray', plane: 'XY', operation: 'new-body',
              parameters: { width: `${width + i * step} mm`, depth: '40 mm', height: '20 mm', wall: '2 mm', corner: '4 mm' },
            },
          });
          made.push(created.value.name);
        }
        return made;
      },
    },
  },
  exporters: {
    openscad: {
      label: 'OpenSCAD polyhedra',
      extension: 'scad',
      mediaType: 'text/plain',
      // One polyhedron per body, from its triangles (mm).
      export({ name, bodies }) {
        const lines = [`// ${name}, exported from CADence`];
        for (const body of bodies) {
          const points = [];
          for (let i = 0; i < body.positions.length; i += 3) points.push(`[${body.positions.slice(i, i + 3).map((v) => +v.toFixed(4)).join(',')}]`);
          const faces = [];
          // OpenSCAD wants faces clockwise seen from outside.
          for (let i = 0; i < body.indices.length; i += 3) faces.push(`[${body.indices[i]},${body.indices[i + 2]},${body.indices[i + 1]}]`);
          lines.push(`// ${body.id}`, `polyhedron(points=[${points.join(',')}], faces=[${faces.join(',')}]);`);
        }
        return `${lines.join('\n')}\n`;
      },
    },
  },
};
