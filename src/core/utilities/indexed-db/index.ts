/** Minimal promise wrapper around IndexedDB; enough for key-value stores with optional indexes. */

export interface StoreSchema {
  readonly name: string;
  readonly keyPath: string;
  readonly indexes?: readonly { readonly name: string; readonly keyPath: string }[];
}

export class KeyValueDatabase {
  private connection: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly name: string,
    private readonly stores: readonly StoreSchema[],
    private readonly factory: IDBFactory = indexedDB,
  ) {}

  get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    return this.run(store, 'readonly', (s) => s.get(key));
  }

  getAll<T>(store: string, index?: { name: string; value: IDBValidKey }): Promise<T[]> {
    return this.run(store, 'readonly', (s) =>
      index ? s.index(index.name).getAll(index.value) : s.getAll(),
    );
  }

  put(store: string, value: unknown): Promise<void> {
    return this.run(store, 'readwrite', (s) => s.put(value)).then(() => undefined);
  }

  delete(store: string, key: IDBValidKey | IDBKeyRange): Promise<void> {
    return this.run(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
  }

  close(): void {
    void this.connection?.then((db) => db.close());
    this.connection = undefined;
  }

  private async run<T>(
    store: string,
    mode: IDBTransactionMode,
    request: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = request(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  private open(): Promise<IDBDatabase> {
    this.connection ??= new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, 1);
      req.onupgradeneeded = () => {
        for (const schema of this.stores) {
          const store = req.result.createObjectStore(schema.name, { keyPath: schema.keyPath });
          for (const index of schema.indexes ?? []) store.createIndex(index.name, index.keyPath);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.connection;
  }
}
