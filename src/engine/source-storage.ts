const DATABASE_NAME = 'graphic-studio-assets-v1';
const STORE_NAME = 'assets';
const SOURCE_KEY = 'last-source';

interface StoredSource {
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable.'));
  });
}

export async function persistSource(file: File): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      store.put(
        {
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        } satisfies StoredSource,
        SOURCE_KEY,
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Source persistence failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Source persistence aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function restoreSource(): Promise<File | null> {
  const database = await openDatabase();
  try {
    const stored = await new Promise<StoredSource | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(SOURCE_KEY);
      request.onsuccess = () => resolve(request.result as StoredSource | undefined);
      request.onerror = () => reject(request.error ?? new Error('Source restore failed.'));
    });
    if (!stored?.blob) return null;
    return new File([stored.blob], stored.name || 'source-image', {
      type: stored.type || stored.blob.type,
      lastModified: stored.lastModified || Date.now(),
    });
  } finally {
    database.close();
  }
}
