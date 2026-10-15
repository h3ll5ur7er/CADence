export type { DocumentAccess } from './document-access';
export { FileSystemDocumentAccess } from './file-system';
export { IndexedDbDocumentAccess } from './indexed-db';
export { InMemoryDocumentAccess } from './in-memory';
export { migrate, type Migration, UnsupportedSchemaError } from './migrations';
