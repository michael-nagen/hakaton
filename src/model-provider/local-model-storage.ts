// ── Model Provider — local model storage ─────────────────────────────
//
// Where downloaded model BINARIES live. Large files must never touch
// localStorage, so this uses IndexedDB. The interface is deliberately small and
// storage-agnostic so it can be swapped later (File System Access API on
// desktop, native file storage on mobile) without changing the download manager
// or UI. All methods take object arguments.

export interface LocalModelStorage {
  saveModelFile(args: { modelId: string; fileName: string; blob: Blob }): Promise<{ localPath?: string }>;
  hasModelFile(args: { modelId: string }): Promise<boolean>;
  deleteModelFile(args: { modelId: string }): Promise<void>;
}

const DB_NAME = 'maestro-local-models';
const STORE = 'files';
const DB_VERSION = 1;

/** Thrown when no persistent storage backend is available in this environment. */
export class LocalModelStorageUnavailableError extends Error {
  constructor() {
    super('Local model storage is not available in this browser.');
    this.name = 'LocalModelStorageUnavailableError';
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new LocalModelStorageUnavailableError());
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'modelId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new LocalModelStorageUnavailableError());
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** IndexedDB-backed storage. Records are `{ modelId, fileName, blob }`. */
export const indexedDbModelStorage: LocalModelStorage = {
  async saveModelFile({ modelId, fileName, blob }) {
    const db = await openDb();
    try {
      await tx(db, 'readwrite', (store) => store.put({ modelId, fileName, blob }));
      return { localPath: `indexeddb://${DB_NAME}/${modelId}` };
    } finally {
      db.close();
    }
  },

  async hasModelFile({ modelId }) {
    try {
      const db = await openDb();
      try {
        const key = await tx<IDBValidKey | undefined>(db, 'readonly', (store) => store.getKey(modelId));
        return key !== undefined;
      } finally {
        db.close();
      }
    } catch {
      // No storage backend → treat as "not downloaded" rather than throwing.
      return false;
    }
  },

  async deleteModelFile({ modelId }) {
    const db = await openDb();
    try {
      await tx(db, 'readwrite', (store) => store.delete(modelId));
    } finally {
      db.close();
    }
  },
};

/** The storage backend the app uses. Swap here to change persistence strategy. */
export const localModelStorage: LocalModelStorage = indexedDbModelStorage;
