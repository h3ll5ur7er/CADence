/** Whether a drag carries files (not text or links). */
export const carriesFiles = (event: DragEvent): boolean => [...(event.dataTransfer?.types ?? [])].includes('Files');

/** The files of a drop. */
export const droppedFiles = (event: DragEvent): File[] => [...(event.dataTransfer?.files ?? [])];

/** CADence project archives (`exportProject`). */
export const isArchive = (file: { readonly name: string }): boolean => /\.cadence$/i.test(file.name);
