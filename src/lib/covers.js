const THUMB_WIDTH = 240;
const SEARCH_THUMB_WIDTH = 320;
const MAX_DATAURL = 120000;
const MAX_SEARCH_COVER_LOADS = 2;
const MAX_SEARCH_COVERS = 60;
const MAX_LIBRARY_COVERS = 240;
const MAX_LIBRARY_COVER_LOADS = 4;
const LIBRARY_COVER_DB = 'cytlex-library-covers';
const LIBRARY_COVER_STORE = 'covers';
const MAX_PERSISTED_LIBRARY_COVERS = 500;
const PROXIED_IMAGE_HOSTS = ['plotnofansub.com'];
const searchCoverCache = new Map();
const loadedSearchCovers = new Set();
const decodedSearchCovers = new Map();
const searchCoverWaiters = [];
const libraryCoverCache = new Map();
const loadedLibraryCovers = new Map();
const libraryCoverVersions = new Map();
const libraryCoverWaiters = [];
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

async function acquireSearchCoverSlot() {
  if (activeSearchCoverLoads < MAX_SEARCH_COVER_LOADS) activeSearchCoverLoads += 1;
  else await new Promise((resolve) => searchCoverWaiters.push(resolve));
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

async function acquireLibraryCoverSlot() {
  if (activeLibraryCoverLoads < MAX_LIBRARY_COVER_LOADS) activeLibraryCoverLoads += 1;
  else await new Promise((resolve) => libraryCoverWaiters.push(resolve));
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

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPersistedLibraryCover(url) {
  try {
    const db = await openLibraryCoverDb();
    if (!db) return null;
    const record = await idbRequest(db.transaction(LIBRARY_COVER_STORE, 'readonly').objectStore(LIBRARY_COVER_STORE).get(url));
    if (!record?.blob) return null;
    const cached = libraryCoverCache.get(url);
    if (typeof cached === 'string') return cached;
    if (cached) return null;
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

async function persistLibraryCover(url, blob, version) {
  try {
    if ((libraryCoverVersions.get(url) || 0) !== version) return;
    const db = await openLibraryCoverDb();
    if (!db) return;
    if ((libraryCoverVersions.get(url) || 0) !== version) return;
    const store = db.transaction(LIBRARY_COVER_STORE, 'readwrite').objectStore(LIBRARY_COVER_STORE);
    store.put({ url, blob, usedAt: Date.now() });
    const count = await idbRequest(store.count());
    if (count <= MAX_PERSISTED_LIBRARY_COVERS) return;
    const records = await idbRequest(db.transaction(LIBRARY_COVER_STORE, 'readonly').objectStore(LIBRARY_COVER_STORE).getAll());
    records.sort((a, b) => a.usedAt - b.usedAt);
    const cleanup = db.transaction(LIBRARY_COVER_STORE, 'readwrite').objectStore(LIBRARY_COVER_STORE);
    records.slice(0, count - MAX_PERSISTED_LIBRARY_COVERS).forEach((record) => cleanup.delete(record.url));
  } catch {}
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
  const next = libraryCoverWaiters.shift();
  if (next) next();
  else activeLibraryCoverLoads -= 1;
}

export function clearSearchCoverCache() {
  searchCoverGeneration += 1;
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

export async function preloadLibraryCover(url) {
  if (!url || typeof window === 'undefined' || !window.cytlex?.fetchImage) return '';
  const cached = libraryCoverCache.get(url);
  if (cached) {
    libraryCoverCache.delete(url);
    libraryCoverCache.set(url, cached);
    return cached;
  }

  let pending;
  pending = (async () => {
    let acquired = false;
    const version = libraryCoverVersions.get(url) || 0;
    try {
      const persisted = await readPersistedLibraryCover(url);
      if (persisted) return persisted;
      await acquireLibraryCoverSlot();
      acquired = true;
      let original = url;
      if (!url.startsWith('data:')) {
        const fetched = await window.cytlex.fetchImage(url);
        if (!fetched?.base64) return '';
        original = `data:${fetched.mime};base64,${fetched.base64}`;
      }
      const blob = await makeCoverThumbBlob(original);
      if (!blob || blob.size > MAX_DATAURL) return '';
      const objectUrl = URL.createObjectURL(blob);
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
      persistLibraryCover(url, blob, version);
      return objectUrl;
    } catch {
      return '';
    } finally {
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
      db.transaction(LIBRARY_COVER_STORE, 'readwrite').objectStore(LIBRARY_COVER_STORE).delete(url);
    } catch {}
  });
}

export function preloadSearchCover(url) {
  if (!url || typeof window === 'undefined' || !window.cytlex?.fetchImage) return Promise.resolve('');
  const cached = searchCoverCache.get(url);
  if (cached) return Promise.resolve(cached);

  const generation = searchCoverGeneration;
  const pending = (async () => {
    let timer;
    let acquired = false;
    try {
      await acquireSearchCoverSlot();
      acquired = true;
      if (generation !== searchCoverGeneration) return '';
      const thumbnail = await Promise.race([
        makeCoverThumb(url, SEARCH_THUMB_WIDTH),
        new Promise((resolve) => { timer = setTimeout(() => resolve(''), 8000); })
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
    }
  })();
  searchCoverCache.set(url, pending);
  pruneSearchCoverCache();
  return pending;
}

export async function makeCoverThumb(url, maxWidth = THUMB_WIDTH) {
  if (typeof window === 'undefined' || !window.cytlex?.fetchImage || !url) return '';
  try {
    const fetched = await window.cytlex.fetchImage(url);
    if (!fetched?.base64) return '';

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

