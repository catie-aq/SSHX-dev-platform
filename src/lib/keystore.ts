/**
 * @file Remembers unlocked keys on this device, in IndexedDB.
 *
 * Keys are stored as non-extractable CryptoKey objects: scripts on the page
 * can use them, but cannot read their bytes.
 */

const DB_NAME = "sshx-platform";
const STORE = "keys";

export type StoredKeys = { vaultKey: CryptoKey; privateKey: CryptoKey };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveKeys(userId: string, keys: StoredKeys): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(keys, userId));
  } catch (err) {
    console.warn("cannot remember keys on this device", err);
  }
}

export async function loadKeys(userId: string): Promise<StoredKeys | null> {
  try {
    return (await run<StoredKeys | undefined>("readonly", (s) => s.get(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function clearKeys(userId: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(userId));
  } catch {
    /* ignore */
  }
}
