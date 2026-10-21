/** The command and feature types as TypeScript source, embedded when the command line is built (tools/automation/build.mjs). */
declare module 'cadence:reference' {
  /** By topic: commands, sketch, features, document, assembly. */
  const reference: Readonly<Record<string, string>>;
  export default reference;
}

/** The user guide's pages (docs/User-guide), by name, embedded when the command line is built (CAD-172). */
declare module 'cadence:guide' {
  const guide: Readonly<Record<string, string>>;
  export default guide;
}
