import { browserImageUrl, fetchCoverBlob, fetchImage, fetchImageBlobBatch, fetchSearchCoverBlobBatch } from './browserHttp.js';

const THUMB_WIDTH = 240;
const SEARCH_THUMB_WIDTH = 320;
const MAX_DATAURL = 120000;
const MAX_SEARCH_COVER_LOADS = 2;
const MAX_SEARCH_COVERS = 300;
const SEARCH_COVER_BATCH_SIZE = 40;
const MAX_LIBRARY_COVERS = 240;
const MAX_LIBRARY_COVER_LOADS = 4;
const PROXY_COVER_BATCH_SIZE = 40;
const LIBRARY_COVER_DB = 'cytlex-library-covers';
const LIBRARY_COVER_STORE = 'covers';
const MAX_PERSISTED_LIBRARY_COVERS = 500;
const PROXIED_IMAGE_HOSTS = ['d33y4i2dmzjqjh.cloudfront.net', 'uploads.mangadex.org'];
const searchCoverCache = new Map();
const loadedSearchCovers = new Set();
const decodedSearchCovers = new Map();
const searchCoverWaiters = [];
const searchCoverControllers = new Set();
const libraryCoverCache = new Map();
const loadedLibraryCovers = new Map();
const libraryCoverVersions = new Map();
const libraryCoverWaiters = [];
const priorityLibraryCovers = new Set();
const failedLibraryCovers = new Map();
const failedCoverHosts = new Map();
let libraryCoverDbPromise;
let searchCoverGeneration = 0;
let activeSearchCoverLoads = 0;
let activeLibraryCoverLoads = 0;

export function requiresImageProxy(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PROXIED_IMAGE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function persistedCoverKey(url) {
  return requiresImageProxy(url) && new URL(url).hostname.toLowerCase().endsWith('mangadex.org')
    ? `mangadex-cover-v2:${url}`
    : url;
}

function pruneSearchCoverCache() {
  while (searchCoverCache.size > MAX_SEARCH_COVERS) {
    const [url, value] = searchCoverCache.entries().next().value;
    searchCoverCache.delete(url);
    if (typeof value === 'string' && value.startsWith('blob:')) {
      loadedSearchCovers.delete(value);
      decodedSearchCovers.delete(value);
      URL.revokeObjectURL(value);
    }
  }
}

async function acquireSearchCoverSlot(signal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  if (activeSearchCoverLoads < (window.cytlex?.fetchImage ? MAX_SEARCH_COVER_LOADS : 40)) {
    activeSearchCoverLoads += 1;
    return;
  }
  await new Promise((resolve, reject) => {
    const waiter = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      const index = searchCoverWaiters.indexOf(waiter);
      if (index !== -1) searchCoverWaiters.splice(index, 1);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    searchCoverWaiters.push(waiter);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function releaseSearchCoverSlot() {
  const next = searchCoverWaiters.shift();
  if (next) next();
  else activeSearchCoverLoads -= 1;
}

function pruneLibraryCoverCache() {
  while (libraryCoverCache.size > MAX_LIBRARY_COVERS) {
    const [url, value] = libraryCoverCache.entries().next().value;
    libraryCoverCache.delete(url);
    if (typeof value === 'string' && value.startsWith('blob:')) {
      loadedLibraryCovers.delete(value);
      URL.revokeObjectURL(value);
    }
  }
}

export function markLibraryCoverLoaded(url) {
  if (!url) return;
  loadedLibraryCovers.delete(url);
  loadedLibraryCovers.set(url, true);
  while (loadedLibraryCovers.size > MAX_LIBRARY_COVERS) {
    loadedLibraryCovers.delete(loadedLibraryCovers.keys().next().value);
  }
}

export function hasLibraryCoverLoaded(url) {
  return !!url && (loadedLibraryCovers.has(url) || loadedSearchCovers.has(url));
}

function startWaitingLibraryCover() {
  const priorityIndex = libraryCoverWaiters.findIndex((waiter) => waiter.priority);
  const maxLoads = window.cytlex?.fetchImage ? MAX_LIBRARY_COVER_LOADS : 40;
  const limit = priorityIndex >= 0 ? maxLoads : maxLoads - 1;
  if (!libraryCoverWaiters.length || activeLibraryCoverLoads >= limit) return;
  const [next] = libraryCoverWaiters.splice(Math.max(priorityIndex, 0), 1);
  activeLibraryCoverLoads += 1;
  next.resolve();
}

function acquireLibraryCoverSlot(url, priority) {
  return new Promise((resolve) => {
    libraryCoverWaiters.push({ url, priority, resolve });
    startWaitingLibraryCover();
  });
}

function openLibraryCoverDb() {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  if (!libraryCoverDbPromise) {
    libraryCoverDbPromise = new Promise((resolve) => {
      const request = indexedDB.open(LIBRARY_COVER_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(LIBRARY_COVER_STORE, { keyPath: 'url' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return libraryCoverDbPromise;
}

export async function clearPersistentLibraryCoverCache() {
  const db = await openLibraryCoverDb();
  db?.close();
  libraryCoverDbPromise = null;

  for (const value of libraryCoverCache.values()) {
    if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
  }
  libraryCoverCache.clear();
  loadedLibraryCovers.clear();
  libraryCoverVersions.clear();
  failedLibraryCovers.clear();
  failedCoverHosts.clear();

  if (!globalThis.indexedDB) return;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(LIBRARY_COVER_DB);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('No se pudo borrar la caché de portadas.'));
    request.onblocked = () => reject(new Error('Cierra otras pestañas de Cytlex e inténtalo de nuevo.'));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPersistedLibraryCover(url, allowedPending = null) {
  try {
    const db = await openLibraryCoverDb();
    if (!db) return null;
    const record = await idbRequest(db.transaction(LIBRARY_COVER_STORE, 'readonly').objectStore(LIBRARY_COVER_STORE).get(persistedCoverKey(url)));
    if (!record?.blob) return null;
    const cached = libraryCoverCache.get(url);
    if (typeof cached === 'string') return cached;
    if (cached && cached !== allowedPending) return null;
    const objectUrl = URL.createObjectURL(record.blob);
    libraryCoverCache.set(url, objectUrl);
    markLibraryCoverLoaded(objectUrl);
    db.transaction(LIBRARY_COVER_STORE, 'readwrite').objectStore(LIBRARY_COVER_STORE).put({ ...record, usedAt: Date.now() });
    pruneLibraryCoverCache();
    return objectUrl;
  } catch {
    return null;
  }
}

async function storeLibraryCoverBlob(url, blob, version, expectedPending, persist = false) {
  const originalObjectUrl = URL.createObjectURL(blob);
  let keepOriginal = false;
  try {
    const thumbnail = await makeCoverThumbBlob(originalObjectUrl);
    const storedBlob = thumbnail && thumbnail.size <= MAX_DATAURL ? thumbnail : null;
    const objectUrl = storedBlob ? URL.createObjectURL(storedBlob) : originalObjectUrl;
    keepOriginal = !storedBlob;
    const decoded = await decodeCover(objectUrl);
    if (!decoded || (libraryCoverVersions.get(url) || 0) !== version) {
      URL.revokeObjectURL(objectUrl);
      return '';
    }
    const current = libraryCoverCache.get(url);
    if (current && current !== expectedPending) {
      URL.revokeObjectURL(objectUrl);
      return typeof current === 'string' ? current : '';
    }
    markLibraryCoverLoaded(objectUrl);
    libraryCoverCache.set(url, objectUrl);
    pruneLibraryCoverCache();
    if (storedBlob) {
      if (persist) {
        if (!await persistLibraryCover(url, storedBlob, version)) return '';
      } else void persistLibraryCover(url, storedBlob, version);
    } else if (persist) return '';
    return objectUrl;
  } finally {
    if (!keepOriginal) URL.revokeObjectURL(originalObjectUrl);
  }
}

async function persistLibraryCover(url, blob, version) {
  try {
    if ((libraryCoverVersions.get(url) || 0) !== version) return false;
    const db = await openLibraryCoverDb();
    if (!db || (libraryCoverVersions.get(url) || 0) !== version) return false;
    const transaction = db.transaction(LIBRARY_COVER_STORE, 'readwrite');
    const transactionComplete = new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    const store = transaction.objectStore(LIBRARY_COVER_STORE);
    store.put({ url: persistedCoverKey(url), blob, usedAt: Date.now() });
    const count = await idbRequest(store.count());
    await transactionComplete;
    if (count <= MAX_PERSISTED_LIBRARY_COVERS) return true;
    const records = await idbRequest(db.transaction(LIBRARY_COVER_STORE, 'readonly').objectStore(LIBRARY_COVER_STORE).getAll());
    records.sort((a, b) => a.usedAt - b.usedAt);
    const cleanupTransaction = db.transaction(LIBRARY_COVER_STORE, 'readwrite');
    const cleanupComplete = new Promise((resolve, reject) => {
      cleanupTransaction.oncomplete = resolve;
      cleanupTransaction.onerror = () => reject(cleanupTransaction.error);
      cleanupTransaction.onabort = () => reject(cleanupTransaction.error);
    });
    const cleanup = cleanupTransaction.objectStore(LIBRARY_COVER_STORE);
    records.slice(0, count - MAX_PERSISTED_LIBRARY_COVERS).forEach((record) => cleanup.delete(record.url));
    await cleanupComplete;
    return true;
  } catch {
    return false;
  }
}

async function persistCachedLibraryCover(url, cover, version) {
  try {
    if (!/^(blob:|data:)/i.test(cover || '')) return false;
    const response = await fetch(cover);
    if (!response.ok) return false;
    return await persistLibraryCover(url, await response.blob(), version);
  } catch {
    return false;
  }
}

export async function restoreLibraryCover(url) {
  if (!url) return '';
  const cached = libraryCoverCache.get(url);
  if (typeof cached === 'string') return cached;
  if (cached) return (await cached) || '';
  return (await readPersistedLibraryCover(url)) || '';
}

export async function invalidateLibraryCovers(urls) {
  const uniqueUrls = [...new Set((urls || []).filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url)))];
  if (!uniqueUrls.length) return;

  const db = await openLibraryCoverDb();
  const transaction = db?.transaction(LIBRARY_COVER_STORE, 'readwrite');
  uniqueUrls.forEach((url) => {
    libraryCoverVersions.set(url, (libraryCoverVersions.get(url) || 0) + 1);
    const cached = libraryCoverCache.get(url);
    libraryCoverCache.delete(url);
    if (typeof cached === 'string' && cached.startsWith('blob:')) {
      loadedLibraryCovers.delete(cached);
      URL.revokeObjectURL(cached);
    }
    transaction?.objectStore(LIBRARY_COVER_STORE).delete(url);
    const storageKey = persistedCoverKey(url);
    if (storageKey !== url) transaction?.objectStore(LIBRARY_COVER_STORE).delete(storageKey);
  });
  if (transaction) {
    await new Promise((resolve) => {
      transaction.oncomplete = resolve;
      transaction.onerror = resolve;
      transaction.onabort = resolve;
    });
  }
}

function releaseLibraryCoverSlot() {
  activeLibraryCoverLoads -= 1;
  startWaitingLibraryCover();
}

export function clearSearchCoverCache() {
  searchCoverGeneration += 1;
  for (const controller of searchCoverControllers) controller.abort();
  searchCoverControllers.clear();
  for (const value of searchCoverCache.values()) {
    if (typeof value === 'string' && value.startsWith('blob:')) {
      loadedSearchCovers.delete(value);
      decodedSearchCovers.delete(value);
      URL.revokeObjectURL(value);
    }
  }
  searchCoverCache.clear();
}

export function getSearchCover(url) {
  const cached = searchCoverCache.get(url || '');
  return typeof cached === 'string' ? cached : '';
}

export function getLibraryCover(url) {
  const cached = libraryCoverCache.get(url || '');
  if (typeof cached !== 'string') return '';
  libraryCoverCache.delete(url);
  libraryCoverCache.set(url, cached);
  return cached;
}

export function preloadLibraryCoversBatch(urls, { web = false, persist = false, onProgress } = {}) {
  const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
  let current = 0;
  const reportProgress = (url) => {
    current += 1;
    onProgress?.({ current, total: uniqueUrls.length, url });
  };
  if (!web || window.cytlex?.fetchImage) {
    return Promise.all(uniqueUrls.map(async (url) => {
      try { return await preloadLibraryCover(url, { web, persist }); }
      finally { reportProgress(url); }
    }));
  }

  const entries = [];
  const tasks = uniqueUrls.map((url) => {
    if (browserImageUrl(url) === url) return Promise.resolve('');
    const cached = libraryCoverCache.get(url);
    if (cached) return persist ? preloadLibraryCover(url, { web: true, persist }) : Promise.resolve(cached);
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const entry = { url, promise, resolve, version: libraryCoverVersions.get(url) || 0, persist };
    libraryCoverCache.set(url, promise);
    entries.push(entry);
    return promise;
  });

  const results = Promise.all(tasks.map((task, index) => task.finally(() => reportProgress(uniqueUrls[index]))));
  if (!entries.length) return results;
  const fallback = async (entry) => {
    if (libraryCoverCache.get(entry.url) === entry.promise) libraryCoverCache.delete(entry.url);
    entry.resolve(await preloadLibraryCover(entry.url, { web: true, persist: entry.persist }));
  };

  void (async () => {
    try {
      const missing = [];
      await Promise.all(entries.map(async (entry) => {
        const persisted = await readPersistedLibraryCover(entry.url, entry.promise);
        if (persisted) entry.resolve(persisted);
        else if (libraryCoverCache.get(entry.url) === entry.promise) missing.push(entry);
      }));

      for (let offset = 0; offset < missing.length; offset += PROXY_COVER_BATCH_SIZE) {
        const batch = missing.slice(offset, offset + PROXY_COVER_BATCH_SIZE);
        await fetchImageBlobBatch(batch.map(({ url }) => ({ url })), undefined, async ({ blob, error }, index) => {
          const entry = batch[index];
          if (error || !blob) { await fallback(entry); return; }
          const cover = await storeLibraryCoverBlob(entry.url, blob, entry.version, entry.promise, entry.persist);
          if (cover) entry.resolve(cover);
          else await fallback(entry);
        });
      }
    } catch {
      await Promise.all(entries.map((entry) => fallback(entry)));
    }
  })();

  return results;
}

export async function preloadLibraryCover(url, { web = false, priority = false, persist = false } = {}) {
  if (!url || typeof window === 'undefined') return '';
  const browserProxy = web && browserImageUrl(url) !== url;
  if (!browserProxy && !window.cytlex?.fetchImage && !/^(data:|blob:)/i.test(url)) return '';
  const host = browserProxy ? new URL(url).hostname : '';
  const cached = libraryCoverCache.get(url);
  if (cached) {
    if (priority && typeof cached !== 'string') {
      priorityLibraryCovers.add(url);
      const queued = libraryCoverWaiters.find((waiter) => waiter.url === url);
      if (queued) {
        queued.priority = true;
        startWaitingLibraryCover();
      }
    }
    libraryCoverCache.delete(url);
    libraryCoverCache.set(url, cached);
    const cover = await cached;
    if (persist && cover && !await persistCachedLibraryCover(url, cover, libraryCoverVersions.get(url) || 0)) return '';
    return cover;
  }

  let pending;
  pending = (async () => {
    let acquired = false;
    let originalObjectUrl;
    const version = libraryCoverVersions.get(url) || 0;
    try {
      const persisted = await readPersistedLibraryCover(url);
      if (persisted) return persisted;
      await acquireLibraryCoverSlot(url, priority || priorityLibraryCovers.has(url));
      acquired = true;
      let original = url;
      if (browserProxy) {
        const now = Date.now();
        if ((failedLibraryCovers.get(url) || 0) > now || (failedCoverHosts.get(host)?.until || 0) > now) return '';
        const signal = AbortSignal.timeout(30000);
        try {
          const image = await fetchCoverBlob(url, signal);
          if (!image) throw new Error('Invalid image');
          failedLibraryCovers.delete(url);
          originalObjectUrl = URL.createObjectURL(image);
          original = originalObjectUrl;
        } catch (error) {
          failedLibraryCovers.delete(url);
          failedLibraryCovers.set(url, Date.now() + 60000);
          if (failedLibraryCovers.size > MAX_LIBRARY_COVERS) failedLibraryCovers.delete(failedLibraryCovers.keys().next().value);
          const dnsFailure = /\bENOTFOUND\b/.test(error.message);
          if (dnsFailure || signal.aborted || /\bHTTP (502|503|504)\b/.test(error.message)) {
            const at = Date.now();
            const previous = failedCoverHosts.get(host);
            const count = previous && at - previous.at < 15000 ? previous.count + 1 : 1;
            failedCoverHosts.delete(host);
            failedCoverHosts.set(host, { at, count, until: dnsFailure || count >= 2 ? at + 15000 : 0 });
            if (failedCoverHosts.size > MAX_LIBRARY_COVERS) failedCoverHosts.delete(failedCoverHosts.keys().next().value);
          }
          return '';
        }
      } else if (!/^(data:|blob:)/i.test(url)) {
        const fetched = await fetchImage(url);
        if (!fetched?.base64) return '';
        original = `data:${fetched.mime};base64,${fetched.base64}`;
      }
      const blob = await makeCoverThumbBlob(original);
      const thumbnail = blob && blob.size <= MAX_DATAURL ? blob : null;
      if (!thumbnail && !originalObjectUrl) return '';
      const objectUrl = thumbnail ? URL.createObjectURL(thumbnail) : originalObjectUrl;
      if (!thumbnail) originalObjectUrl = undefined;
      const decoded = await decodeCover(objectUrl);
      if (!decoded) {
        URL.revokeObjectURL(objectUrl);
        return '';
      }
      if ((libraryCoverVersions.get(url) || 0) !== version) {
        URL.revokeObjectURL(objectUrl);
        return '';
      }
      markLibraryCoverLoaded(objectUrl);
      const current = libraryCoverCache.get(url);
      if (current && current !== pending) {
        loadedLibraryCovers.delete(objectUrl);
        URL.revokeObjectURL(objectUrl);
        return current;
      }
      libraryCoverCache.set(url, objectUrl);
      pruneLibraryCoverCache();
      if (thumbnail) {
        if (persist) {
          if (!await persistLibraryCover(url, thumbnail, version)) return '';
        }
        else void persistLibraryCover(url, thumbnail, version);
      } else if (persist) return '';
      return objectUrl;
    } catch {
      return '';
    } finally {
      priorityLibraryCovers.delete(url);
      if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl);
      if (acquired) releaseLibraryCoverSlot();
      if (libraryCoverCache.get(url) === pending) libraryCoverCache.delete(url);
    }
  })();
  libraryCoverCache.set(url, pending);
  pruneLibraryCoverCache();
  return pending;
}

export function discardLibraryCover(url, objectUrl) {
  libraryCoverVersions.set(url, (libraryCoverVersions.get(url) || 0) + 1);
  if (libraryCoverCache.get(url) === objectUrl) libraryCoverCache.delete(url);
  loadedLibraryCovers.delete(objectUrl);
  if (typeof objectUrl === 'string' && objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
  openLibraryCoverDb().then((db) => {
    if (!db) return;
    try {
      const store = db.transaction(LIBRARY_COVER_STORE, 'readwrite').objectStore(LIBRARY_COVER_STORE);
      store.delete(url);
      const storageKey = persistedCoverKey(url);
      if (storageKey !== url) store.delete(storageKey);
    } catch {}
  });
}

export function preloadSearchCover(url) {
  if (!url || typeof window === 'undefined') return Promise.resolve('');
  const cached = searchCoverCache.get(url);
  if (cached) return Promise.resolve(cached);

  const generation = searchCoverGeneration;
  const controller = new AbortController();
  searchCoverControllers.add(controller);
  const pending = (async () => {
    let timer;
    let acquired = false;
    try {
      await acquireSearchCoverSlot(controller.signal);
      acquired = true;
      if (generation !== searchCoverGeneration) return '';
      const thumbnail = await Promise.race([
        makeCoverThumb(url, SEARCH_THUMB_WIDTH, controller.signal),
        new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(''); }, 8000); })
      ]);
      if (!thumbnail) return '';
      const blob = await (await fetch(thumbnail)).blob();
      const objectUrl = URL.createObjectURL(blob);
      const decoded = await decodeCover(objectUrl);
      if (!decoded) {
        URL.revokeObjectURL(objectUrl);
        return '';
      }
      if (generation !== searchCoverGeneration) {
        URL.revokeObjectURL(objectUrl);
        return '';
      }
      loadedSearchCovers.add(objectUrl);
      decodedSearchCovers.set(objectUrl, decoded);
      searchCoverCache.set(url, objectUrl);
      pruneSearchCoverCache();
      return objectUrl;
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
      if (acquired) releaseSearchCoverSlot();
      searchCoverControllers.delete(controller);
      if (searchCoverCache.get(url) === pending) searchCoverCache.delete(url);
    }
  })();
  searchCoverCache.set(url, pending);
  pruneSearchCoverCache();
  return pending;
}

export function createSearchCoverBatch() {
  const generation = searchCoverGeneration;
  const queue = [];
  const controllers = new Set();
  const inFlight = new Set();
  let cancelled = false;

  const dispatch = (entries) => {
    if (!entries.length) return Promise.resolve();
    if (cancelled || generation !== searchCoverGeneration) {
      entries.forEach((entry) => entry.resolve(''));
      return Promise.resolve();
    }
    const fail = (entry) => {
      if (searchCoverCache.get(entry.url) === entry.promise) searchCoverCache.delete(entry.url);
      entry.resolve('');
    };
    const controller = new AbortController();
    controllers.add(controller);
    const task = fetchSearchCoverBlobBatch(entries, controller.signal, async ({ blob }, index) => {
      const entry = entries[index];
      if (cancelled || generation !== searchCoverGeneration || !blob) {
        fail(entry);
        return;
      }
      const originalUrl = URL.createObjectURL(blob);
      const thumbnail = await makeCoverThumbBlob(originalUrl, SEARCH_THUMB_WIDTH);
      URL.revokeObjectURL(originalUrl);
      if (!thumbnail) {
        fail(entry);
        return;
      }
      const objectUrl = URL.createObjectURL(thumbnail);
      const decoded = await decodeCover(objectUrl);
      if (!decoded || cancelled || generation !== searchCoverGeneration) {
        URL.revokeObjectURL(objectUrl);
        fail(entry);
        return;
      }
      loadedSearchCovers.add(objectUrl);
      decodedSearchCovers.set(objectUrl, decoded);
      if (searchCoverCache.get(entry.url) === entry.promise) searchCoverCache.set(entry.url, objectUrl);
      pruneSearchCoverCache();
      entry.resolve(objectUrl);
    }).catch(() => {
      entries.forEach(fail);
    }).finally(() => {
      controllers.delete(controller);
      searchCoverControllers.delete(controller);
      inFlight.delete(task);
    });
    inFlight.add(task);
    searchCoverControllers.add(controller);
    return task;
  };

  const preload = (url) => {
    if (cancelled || !url || typeof window === 'undefined' || browserImageUrl(url) === url) return Promise.resolve('');
    const cached = searchCoverCache.get(url);
    if (cached) return Promise.resolve(cached);

    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const entry = { url, promise, resolve };
    searchCoverCache.set(url, promise);
    queue.push(entry);
    if (queue.length >= SEARCH_COVER_BATCH_SIZE) dispatch(queue.splice(0, SEARCH_COVER_BATCH_SIZE));
    pruneSearchCoverCache();
    return promise;
  };

  const flush = async () => {
    if (cancelled || generation !== searchCoverGeneration) return;
    const tasks = [];
    while (queue.length) tasks.push(dispatch(queue.splice(0, SEARCH_COVER_BATCH_SIZE)));
    await Promise.all([...inFlight, ...tasks]);
  };

  const cancel = () => {
    cancelled = true;
    controllers.forEach((controller) => controller.abort());
    queue.splice(0).forEach((entry) => {
      if (searchCoverCache.get(entry.url) === entry.promise) searchCoverCache.delete(entry.url);
      entry.resolve('');
    });
  };

  return { preload, flush, cancel };
}

export async function makeCoverThumb(url, maxWidth = THUMB_WIDTH, signal) {
  if (typeof window === 'undefined' || !url) return '';
  try {
    const fetched = await fetchImage(url, signal);
    if (signal?.aborted || !fetched?.base64) return '';

    const blob = await (await fetch(`data:${fetched.mime};base64,${fetched.base64}`)).blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objUrl;
      });
      if (!img.width) return '';

      const width = Math.min(maxWidth, img.width);
      const height = Math.max(1, Math.round((img.height / img.width) * width));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      return dataUrl.length <= MAX_DATAURL ? dataUrl : '';
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch {
    return '';
  }
}

async function makeCoverThumbBlob(source, maxWidth = THUMB_WIDTH) {
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = source;
    });
    if (!image.width) return null;

    const width = Math.min(maxWidth, image.width);
    const height = Math.max(1, Math.round((image.height / image.width) * width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  } catch {
    return null;
  }
}

function decodeCover(url) {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
    if (image.decode) image.decode().then(() => finish(image), () => {});
  });
}

