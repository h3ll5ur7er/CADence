import type { CadDocument, DocumentId, DocumentSummary, ProjectId } from '@core/contracts';
import { KeyValueDatabase } from '@core/utilities/indexed-db';
import type { DocumentAccess } from './document-access';
import { migrate, summaryOf } from './migrations';

const store = 'documents';

export class IndexedDbDocumentAccess implements DocumentAccess {
  private readonly db: KeyValueDatabase;

  constructor(databaseName = 'cadence-documents', factory?: IDBFactory) {
    this.db = new KeyValueDatabase(
      databaseName,
      [{ name: store, keyPath: 'id', indexes: [{ name: 'projectId', keyPath: 'projectId' }] }],
      factory,
    );
  }

  async enumerate(projectId: ProjectId): Promise<DocumentSummary[]> {
    const raw = await this.db.getAll<Record<string, unknown>>(store, { name: 'projectId', value: projectId });
    return raw.map(summaryOf);
  }

  async load(id: DocumentId): Promise<CadDocument | undefined> {
    const raw = await this.db.get<Record<string, unknown>>(store, id);
    return raw && migrate(raw);
  }

  store(document: CadDocument): Promise<void> {
    return this.db.put(store, document);
  }

  discard(id: DocumentId): Promise<void> {
    return this.db.delete(store, id);
  }
}
