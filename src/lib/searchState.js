export const lastSearch = { q: '', genre: '', results: null };

const seenCovers = new Map();

export function rememberCover(url, cover) {
  if (url && cover) seenCovers.set(url, cover);
}

export function recallCover(url) {
  return seenCovers.get(url || '') || '';
}

export const scrollMemory = { catalog: 0 };

const resultsScrollMap = new Map();

export const resultsScroll = {
  get(sourceId) {
    return resultsScrollMap.get(sourceId || '') ?? 0;
  },
  set(sourceId, top) {
    if (!sourceId || !Number.isFinite(top) || top < 0) return;
    resultsScrollMap.set(sourceId, top);
  },
  has(sourceId) {
    return resultsScrollMap.has(sourceId || '');
  },
  clear() {
    resultsScrollMap.clear();
  }
};

const detailScrollMap = new Map();

let restorePending = false;

export const detailScroll = {
  get(mangaUrl) {
    return detailScrollMap.get(mangaUrl || '') ?? 0;
  },
  set(mangaUrl, top) {
    if (!mangaUrl || !Number.isFinite(top) || top < 0) return;
    detailScrollMap.set(mangaUrl, top);
  },
  requestRestore() {
    restorePending = true;
  },
  takeRestore(mangaUrl) {
    if (!restorePending) return 0;
    restorePending = false;
    return detailScrollMap.get(mangaUrl || '') ?? 0;
  },
  clear() {
    detailScrollMap.clear();
    restorePending = false;
  }
};

const ORDER_KEY = 'cytlex:chapterOrder:v2';

const readOrder = () => {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || {}; } catch { return {}; }
};

export const chapterOrder = {
  get(mangaUrl) {
    return readOrder()[mangaUrl || ''] === 'asc';
  },
  set(mangaUrl, asc) {
    if (!mangaUrl) return;
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({ ...readOrder(), [mangaUrl]: asc ? 'asc' : 'desc' }));
    } catch {}
  }
};

const coverOkCache = new Set();

export function testCover(url) {
  if (!url) return Promise.resolve(false);
  if (coverOkCache.has(url)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      if (ok) coverOkCache.add(url);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 8000);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

