/**
 * Revision Engine: what changed between two versions of a document, and three-way merges of
 * documents (docs/Architecture/Decisions.md#adr-61). Pure and synchronous, like the Sheet Metal Engine.
 */
export { compareDocuments, type MergeOptions, type MergeOutcome, mergeDocuments } from './revision';
