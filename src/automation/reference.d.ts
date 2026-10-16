/** The command and feature types as TypeScript source, embedded when the command line is built (tools/automation/build.mjs). */
declare module 'cadence:reference' {
  /** By topic: commands, sketch, features, document, assembly. */
  const reference: Readonly<Record<string, string>>;
  export default reference;
}
