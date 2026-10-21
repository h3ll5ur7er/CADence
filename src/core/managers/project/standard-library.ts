import {
  asDocumentId,
  bearings,
  type BearingSize,
  steppers,
  type StepperSize,
  type ComponentDocument,
  currentSchemaVersion,
  type LibraryPart,
  type Material,
  materials,
  metricSizes,
  type MetricSize,
  type PartSpec,
  type ProjectId,
  standardLibraryId,
} from '@core/contracts';

/**
 * The built-in library of standard parts (CAD-152): the catalogue parts of the part feature in every
 * size, each a component of its own made on demand. Its version changes only when the catalogue does.
 */
export const standardLibraryName = 'Standard parts';
export const standardLibraryVersion = 'standard-1';

/** ISO 4762 lengths (mm) for each size, from the shortest to the longest stocked. */
const screwLengths: Readonly<Record<MetricSize, readonly number[]>> = {
  M2: [3, 4, 5, 6, 8, 10, 12, 16, 20],
  'M2.5': [4, 5, 6, 8, 10, 12, 16, 20, 25],
  M3: [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40],
  M4: [5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50],
  M5: [6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60],
  M6: [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80],
  M8: [10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
  M10: [12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100],
};

interface StandardPart {
  readonly key: string;
  readonly designation: string;
  readonly group: string;
  readonly spec: PartSpec;
}

/** Every part of the catalogue, by group and size. */
export const standardParts: readonly StandardPart[] = [
  ...metricSizes.flatMap((size) =>
    screwLengths[size].map((length) => ({ key: `screw-${size}-${length}`, designation: `ISO 4762 ${size} × ${length}`, group: 'Screws (ISO 4762)', spec: { kind: 'screw', size, length: `${length} mm` } as const })),
  ),
  ...metricSizes.map((size) => ({ key: `nut-${size}`, designation: `ISO 4032 ${size}`, group: 'Nuts (ISO 4032)', spec: { kind: 'nut', size } as const })),
  ...metricSizes.map((size) => ({ key: `washer-${size}`, designation: `ISO 7089 ${size}`, group: 'Washers (ISO 7089)', spec: { kind: 'washer', size } as const })),
  ...metricSizes.map((size) => ({ key: `insert-${size}`, designation: `Heat-set insert ${size}`, group: 'Heat-set inserts', spec: { kind: 'insert', size } as const })),
  ...(Object.keys(bearings) as BearingSize[]).map((size) => ({ key: `bearing-${size}`, designation: `Ball bearing ${size}`, group: 'Ball bearings', spec: { kind: 'bearing', size } as const })),
  // Stepper motors in their common lengths (CAD-194).
  ...(Object.keys(steppers) as StepperSize[]).flatMap((size) =>
    steppers[size].lengths.map((length) => ({ key: `stepper-${size.replace(' ', '')}-${length}`, designation: `Stepper motor ${size} × ${length}`, group: 'Stepper motors', spec: { kind: 'stepper', size, length: `${length} mm` } as const })),
  ),
];

const byKey = new Map(standardParts.map((part) => [part.key, part]));

/** The catalogue as a library lists it. */
export const standardLibraryParts = (): LibraryPart[] => standardParts.map(({ key, designation, group }) => ({ id: key, name: designation, group }));

/** A standard part by its key, or by its designation (`ISO 4762 M3 × 12`; `x` for `×` will do). */
export function findStandardPart(keyOrDesignation: string): StandardPart | undefined {
  // The thin bearings' other name: 618xx for 68xx.
  const wanted = keyOrDesignation.trim().toLowerCase().replace(/\s*[x×]\s*/g, ' × ').replace(/\s+/g, ' ').replace(/^ball bearing 618(\d\d)$/, 'ball bearing 68$1');
  return byKey.get(keyOrDesignation.trim()) ?? standardParts.find((part) => part.designation.toLowerCase() === wanted);
}

/**
 * A standard part as a component of a project: a part feature at the origin of the XY plane, in
 * steel (a motor as heavy as one), named by its designation. A screw's head stands on the plane and its shank goes down the
 * z axis, so its origin lies on the face it is screwed against.
 */
export function standardComponent(part: StandardPart, projectId: ProjectId, id: string, now: string): ComponentDocument {
  return {
    id: asDocumentId(id),
    projectId,
    kind: 'component',
    name: part.designation,
    createdAt: now,
    modifiedAt: now,
    schemaVersion: currentSchemaVersion,
    units: 'mm',
    parameters: [],
    timeline: [
      { id: 's', type: 'sketch', name: 'Origin', suppressed: false, plane: 'XY', entities: [], constraints: [] },
      { id: 'part', type: 'part', name: part.designation, suppressed: false, part: part.spec, sketch: 's', points: ['origin'], angle: '0 deg', flip: false, operation: 'new-body' },
    ],
    rollbackIndex: 0,
    // A motor weighs as its case, coils and magnet do together: a NEMA 17 × 40 about 280 g (CAD-194).
    material: part.spec.kind === 'stepper' ? { name: 'Stepper motor', density: 4 } : ((materials.find((m) => m.name === 'Steel') ?? materials[0]) as Material),
    library: { library: standardLibraryId, libraryName: standardLibraryName, document: part.key, version: standardLibraryVersion, follow: 'asked' },
  };
}
