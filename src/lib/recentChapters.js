const DB_NAME = 'cytlex-recent-chapters';
const STORE = 'chapters';
const MAX_CHAPTERS = 5;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_AGE = 24 * 60 * 60 * 1000;
let opening;

function openDb() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return opening ??= new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
}

export async function readRecentChapter(key) {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = request.result;
        if (!entry || Date.now() - entry.savedAt > MAX_AGE || Date.now() < entry.savedAt
          || !entry.pages?.length || entry.pages.length !== entry.images?.length || entry.images.some((blob) => !(blob instanceof Blob))) {
          if (entry) store.delete(key);
          resolve(null);
          return;
        }
        entry.at = Date.now();
        store.put(entry);
        resolve({ ...entry.chapter, pages: entry.pages, pageFallbacks: entry.pageFallbacks, imageReferer: entry.imageReferer, fromRecentCache: true,
          combinedImages: entry.images.map((blob) => Promise.resolve(blob)) });
      };
      request.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch { return null; }
}

export async function clearRecentChapters() {
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function writeRecentChapter(key, chapter, images) {
  const bytes = images.reduce((sum, blob) => sum + (blob?.size || 0), 0);
  if (!chapter?.pages?.length || images.length !== chapter.pages.length || images.some((blob) => !(blob instanceof Blob)) || bytes > MAX_BYTES) return;
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result.filter((entry) => entry.key !== key).sort((a, b) => a.at - b.at);
        let total = records.reduce((sum, entry) => sum + (entry.bytes || 0), bytes);
        while (records.length >= MAX_CHAPTERS || total > MAX_BYTES) {
          const oldest = records.shift();
          if (!oldest) break;
          total -= oldest.bytes || 0;
          store.delete(oldest.key);
        }
        const now = Date.now();
        store.put({ key, at: now, savedAt: now, bytes, pages: chapter.pages, pageFallbacks: chapter.pageFallbacks || [], imageReferer: chapter.imageReferer || '',
          chapter: { label: chapter.label || '', mangaUrl: chapter.mangaUrl || '', number: chapter.number, options: chapter.options || [], prev: chapter.prev || null, next: chapter.next || null }, images });
      };
      tx.oncomplete = tx.onabort = tx.onerror = () => resolve();
    });
  } catch {}
}
