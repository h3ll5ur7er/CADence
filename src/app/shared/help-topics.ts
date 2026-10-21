/**
 * Where the tools and dialogs find their help (CAD-181): a page of the User guide and a heading on
 * it. `tools/docs/help-links.spec.ts` checks that every page and heading exists.
 */
export const userGuide = 'https://github.com/h3ll5ur7er/CADence/blob/master/docs/User-guide';

export const helpTopics = {
  'getting-started': { page: 'Getting-started', heading: 'The tour', label: 'Getting started' },
  'new-project': { page: 'Projects-and-versions', heading: 'New projects, copies and files', label: 'New projects' },
  versions: { page: 'Projects-and-versions', heading: 'Versions', label: 'Versions' },
  sync: { page: 'Projects-and-versions', heading: 'Sync with git', label: 'Sync with git' },
  share: { page: 'Projects-and-versions', heading: 'Share a model', label: 'Share a model' },
  sketching: { page: 'Sketching', heading: 'Draw', label: 'Sketching' },
  features: { page: 'Part-modeling', heading: 'Features', label: 'Features' },
  holes: { page: 'Part-modeling', heading: 'Holes and threads', label: 'Holes and threads' },
  parameters: { page: 'Part-modeling', heading: 'Parameters', label: 'Parameters' },
  'export-part': { page: 'Part-modeling', heading: 'Export for printing and CAD', label: 'Export' },
  measure: { page: 'Measuring-and-checking', heading: 'Measure', label: 'Measuring' },
  check: { page: 'Measuring-and-checking', heading: 'Check manufacturability', label: 'Manufacturability checks' },
  strength: { page: 'Measuring-and-checking', heading: 'Check strength', label: 'Strength checks' },
  joints: { page: 'Assemblies', heading: 'Joints', label: 'Joints' },
  'motion-links': { page: 'Assemblies', heading: 'Motion links', label: 'Motion links' },
  patterns: { page: 'Assemblies', heading: 'Patterns and mirrors', label: 'Patterns and mirrors' },
  'assembly-measure': { page: 'Assemblies', heading: 'Measure and mass', label: 'Measure and mass' },
  motion: { page: 'Assemblies', heading: 'Motion studies', label: 'Motion studies' },
  explode: { page: 'Assemblies', heading: 'Exploded views and build instructions', label: 'Exploded views' },
  drawings: { page: 'Drawings', heading: 'Views', label: 'Drawings' },
  imported: { page: 'Importing', heading: 'The imported viewer', label: 'Imported files' },
  section: { page: 'Viewing-and-controls', heading: 'Move around', label: 'Section view' },
  analysis: { page: 'Viewing-and-controls', heading: 'Surface analysis', label: 'Surface analysis' },
  looks: { page: 'Viewing-and-controls', heading: 'How bodies look', label: 'Looks and pictures' },
  shortcuts: { page: 'Viewing-and-controls', heading: 'Keyboard shortcuts', label: 'Keyboard shortcuts' },
  phone: { page: 'Viewing-and-controls', heading: 'On a phone or tablet', label: 'Phones and tablets' },
} as const satisfies Readonly<Record<string, { readonly page: string; readonly heading: string; readonly label: string }>>;

export type HelpTopic = keyof typeof helpTopics;

/** A heading's anchor as GitHub makes it: lower case, punctuation dropped, spaces as hyphens. */
export const anchorOf = (heading: string): string =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');

/** The User guide page and heading of a topic. */
export const helpUrl = (topic: HelpTopic): string => {
  const { page, heading } = helpTopics[topic];
  return `${userGuide}/${page}.md#${anchorOf(heading)}`;
};
