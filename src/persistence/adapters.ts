import type { PersistenceAdapter } from '../public/runtime-types';

/** A deterministic adapter useful for tests and small applications. */
export class MemoryPersistenceAdapter implements PersistenceAdapter {
  private bytes: Uint8Array | undefined;

  public read(): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.bytes?.slice());
  }

  public write(bytes: Uint8Array): Promise<void> {
    this.bytes = bytes.slice();
    return Promise.resolve();
  }
}

export interface IndexedDbPersistenceOptions {
  readonly databaseName?: string;
  readonly storeName?: string;
  readonly key?: string;
  readonly indexedDb?: IDBFactory;
}

const openDatabase = (
  factory: IDBFactory | undefined,
  databaseName: string,
  storeName: string,
): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (factory === undefined) {
      reject(new Error('tessera:persistence:indexeddb_unavailable:IndexedDB is unavailable'));
      return;
    }
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });

const readIndexedDb = async (
  database: IDBDatabase,
  storeName: string,
  key: string,
): Promise<Uint8Array | undefined> =>
  new Promise<Uint8Array | undefined>((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => {
      const value: unknown = request.result;
      if (value === undefined) {
        resolve(undefined);
      } else if (value instanceof ArrayBuffer) {
        resolve(new Uint8Array(value).slice());
      } else {
        reject(new Error('IndexedDB save record is not an ArrayBuffer'));
      }
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
  });

const writeIndexedDb = async (
  database: IDBDatabase,
  storeName: string,
  key: string,
  bytes: Uint8Array,
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(bytes.slice().buffer, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
    transaction.onabort = () => reject(new Error('IndexedDB write was interrupted'));
  });

/** Creates an IndexedDB adapter with one explicitly named save record. */
export const createIndexedDbPersistenceAdapter = (
  options: IndexedDbPersistenceOptions = {},
): PersistenceAdapter => {
  const databaseName = options.databaseName ?? 'tessera';
  const storeName = options.storeName ?? 'saves';
  const key = options.key ?? 'current';
  const factory = options.indexedDb ?? globalThis.indexedDB;
  return {
    read: async () => {
      const database = await openDatabase(factory, databaseName, storeName);
      try {
        return await readIndexedDb(database, storeName, key);
      } finally {
        database.close();
      }
    },
    write: async (bytes) => {
      const database = await openDatabase(factory, databaseName, storeName);
      try {
        await writeIndexedDb(database, storeName, key, bytes);
      } finally {
        database.close();
      }
    },
  };
};

/** Imports opaque save bytes from a browser File or Blob. */
export const importSaveFile = async (file: Blob): Promise<Uint8Array> =>
  new Uint8Array(await file.arrayBuffer());

/** Downloads opaque save bytes without inspecting or rewriting the Rust DTO. */
export const exportSaveFile = (bytes: Uint8Array, filename = 'tessera-save.json'): void => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
