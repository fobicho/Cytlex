const stores = ['details', 'searches'];
let opening;

function openCache() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('cytlex-source-cache', 1);
    request.onupgradeneeded = () => {
      for (const name of stores) {
        request.result.createObjectStore(name, { keyPath: 'key' }).createIndex('at', 'at');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve(null);
  });
}

export async function readSourceCache(name, key) {
  try {
    const db = await openCache();
    if (!db) return null;
    return await new Promise((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function writeSourceCache(name, key, value, limit) {
  try {
    const db = await openCache();
    if (!db) return;
    const store = db.transaction(name, 'readwrite').objectStore(name);
    store.put({ key, value, at: Date.now() });
    const count = store.count();
    count.onsuccess = () => {
      let excess = count.result - limit;
      if (excess <= 0) return;
      const cursor = store.index('at').openKeyCursor();
      cursor.onsuccess = () => {
        if (!cursor.result || excess <= 0) return;
        store.delete(cursor.result.primaryKey);
        excess -= 1;
        cursor.result.continue();
      };
    };
  } catch {}
}

export async function clearSourceCache() {
  const db = await openCache();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(stores, 'readwrite');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
    for (const name of stores) transaction.objectStore(name).clear();
  });
}
