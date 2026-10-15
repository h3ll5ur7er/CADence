/**
 * Display names of bodies. A body's id is the id of the feature that made it, or `<feature>:<n>` for
 * further bodies of the same feature (patterns, mirrors, imports); those are numbered in order:
 * "Circular pattern 1", "Circular pattern 1 (2)", …
 */
export function bodyNames(bodyIds: readonly string[], timeline: readonly { readonly id: string; readonly name: string }[]): Map<string, string> {
  const seen = new Map<string, number>();
  return new Map(
    bodyIds.map((id) => {
      const feature = id.split(':')[0] ?? id;
      const ordinal = (seen.get(feature) ?? 0) + 1;
      seen.set(feature, ordinal);
      const name = timeline.find((i) => i.id === feature)?.name ?? id;
      return [id, ordinal === 1 || name === id ? name : `${name} (${ordinal})`];
    }),
  );
}
