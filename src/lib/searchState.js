export const lastSearch = { q: '', genre: '', results: null };
export const MAX_SEARCH_RESULTS = 30;

const seenCovers = new Map();

export function rememberCover(url, cover) {
  if (url && cover) seenCovers.set(url, cover);
}

export function recallCover(url) {
  return seenCovers.get(url || '') || '';
}

export const scrollMemory = { catalog: 0 };

const catalogScrollMap = new Map();

export const catalogScroll = {
  get(sourceId) {
    return catalogScrollMap.get(sourceId || '') ?? 0;
  },
  set(sourceId, left) {
    if (!sourceId || !Number.isFinite(left) || left < 0) return;
    catalogScrollMap.set(sourceId, left);
  },
  clear() {
    catalogScrollMap.clear();
  }
};

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
