import { isMangaCover, mangaSourceUrl } from './library.js';

export const lastSearch = { q: '', genre: '', results: null };
export const MAX_SEARCH_RESULTS = 30;
export const SOURCE_CATALOG_HOME_EVENT = 'cytlex:source-catalog-home';
export const MANGA_CATALOG_HOME_EVENT = 'cytlex:manga-catalog-home';
const EXPLORE_TABS = new Set(['mangas', 'extensiones', 'fuentes']);
let lastExploreTab = 'mangas';
let lastExploreLocation = '/explorar?tab=mangas';
let lastLibraryLocation = '/biblioteca';

export function rememberLibraryLocation(location) {
  const isLibraryDetail = location?.pathname === '/manga'
    && new URLSearchParams(location.search || '').get('from') === 'biblioteca';
  if (location?.pathname !== '/biblioteca' && !isLibraryDetail) return;
  lastLibraryLocation = `${location.pathname}${location.search || ''}`;
}

export function libraryReturnRoute() {
  return lastLibraryLocation;
}

export function rememberExploreTab(tab) {
  if (EXPLORE_TABS.has(tab)) lastExploreTab = tab;
}

export function rememberExploreLocation(location) {
  const params = new URLSearchParams(location?.search || '');
  if (location?.pathname === '/explorar'
    && (params.has('migrationFrom') || params.has('migrationSource') || params.has('migrationTargets'))) return;
  const isExploreDetail = location?.pathname === '/manga'
    && ['explorar', 'fuentes', 'resultados'].includes(params.get('from'));
  if (location?.pathname !== '/explorar' && !isExploreDetail) return;
  const search = location.search || '';
  const tab = isExploreDetail
    ? params.get('from') === 'fuentes' ? 'fuentes' : 'mangas'
    : params.get('tab');
  lastExploreLocation = `${location.pathname}${search}`;
  rememberExploreTab(tab);
}

export function exploreReturnRoute() {
  return lastExploreLocation;
}

export function exploreHomeRoute(location) {
  const params = new URLSearchParams(location.search);
  const from = location.pathname.startsWith('/manga') ? params.get('from') : '';
  const currentTab = params.get('tab');
  const tab = from
    ? from === 'fuentes' ? 'fuentes' : from === 'extensiones' ? 'extensiones' : 'mangas'
    : location.pathname === '/resultados'
      ? 'mangas'
      : location.pathname === '/explorar' && EXPLORE_TABS.has(currentTab)
        ? currentTab
        : lastExploreTab;
  return `/explorar?tab=${tab}`;
}

export const isExploreHomeRoute = (location, route) =>
  location.pathname === '/explorar' && `${location.pathname}${location.search}` === route;

const seenCovers = new Map();
const MAX_SEEN_COVERS = 120;
const mangaPreviews = new Map();

const coverCacheKey = (url, sourceId = '') => `${sourceId || ''}|${mangaSourceUrl(url, sourceId) || ''}`;

export function rememberCover(url, cover, sourceId = '') {
  if (!url || !cover || !isMangaCover(cover, url)) return;
  const key = coverCacheKey(url, sourceId);
  seenCovers.delete(key);
  seenCovers.set(key, cover);
  while (seenCovers.size > MAX_SEEN_COVERS) seenCovers.delete(seenCovers.keys().next().value);
}

export function recallCover(url, sourceId = '') {
  const key = coverCacheKey(url, sourceId);
  const cover = seenCovers.get(key) || '';
  if (cover) {
    seenCovers.delete(key);
    seenCovers.set(key, cover);
  }
  return cover;
}

export function rememberMangaPreview(manga, sourceId, image) {
  if (!manga?.url) return;
  const key = coverCacheKey(manga.url, sourceId);
  const previous = mangaPreviews.get(key);
  mangaPreviews.delete(key);
  mangaPreviews.set(key, {
    title: manga.title || previous?.title,
    author: manga.author || manga.artist || previous?.author || '',
    cover: manga.cover,
    image: image?.complete && image.naturalWidth > 0
      ? image.currentSrc
      : previous?.cover === manga.cover ? previous?.image || '' : ''
  });
  while (mangaPreviews.size > MAX_SEEN_COVERS) mangaPreviews.delete(mangaPreviews.keys().next().value);
  rememberCover(manga.url, manga.cover, sourceId);
}

export function recallMangaPreview(url, sourceId) {
  return mangaPreviews.get(coverCacheKey(url, sourceId));
}

export const scrollMemory = { catalog: 0 };

const libraryScrollMap = new Map();

export const libraryScroll = {
  get(categoryId) {
    return libraryScrollMap.get(categoryId || '') ?? 0;
  },
  set(categoryId, top) {
    if (!Number.isFinite(top) || top < 0) return;
    libraryScrollMap.set(categoryId || '', top);
  }
};

let sourceCatalogSnapshot = null;
let restoreSourceCatalog = false;

export const sourceCatalogState = {
  save(snapshot) {
    if (!snapshot?.sourceId) return;
    const scrollTop = sourceCatalogSnapshot?.sourceId === snapshot.sourceId
      ? sourceCatalogSnapshot.scrollTop || 0
      : 0;
    sourceCatalogSnapshot = { ...snapshot, scrollTop };
  },
  saveScroll(scrollTop) {
    if (sourceCatalogSnapshot && Number.isFinite(scrollTop) && scrollTop >= 0) {
      sourceCatalogSnapshot.scrollTop = scrollTop;
    }
  },
  getScrollTop() {
    return sourceCatalogSnapshot?.scrollTop ?? 0;
  },
  requestRestore() {
    restoreSourceCatalog = true;
  },
  takeRestore() {
    if (!restoreSourceCatalog) return null;
    restoreSourceCatalog = false;
    return sourceCatalogSnapshot;
  },
  clear() {
    sourceCatalogSnapshot = null;
    restoreSourceCatalog = false;
  }
};

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

export function resetSubrouteScroll(route) {
  const [pathname, search = ''] = String(route || '').split('?');
  if (pathname === '/biblioteca') {
    let category = '';
    try { category = localStorage.getItem('cytlex:libraryCategory') || ''; } catch {}
    libraryScroll.set(category, 0);
  } else if (pathname === '/explorar') {
    scrollMemory.catalog = 0;
    sourceCatalogState.saveScroll(0);
  } else if (pathname === '/resultados') {
    resultsScroll.set(new URLSearchParams(search).get('s'), 0);
  }
}

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
  },
  move(mangaUrl, nextUrl) {
    if (!mangaUrl || !nextUrl || mangaUrl === nextUrl) return;
    try {
      const order = readOrder();
      if (order[mangaUrl] === undefined) return;
      if (order[nextUrl] === undefined) order[nextUrl] = order[mangaUrl];
      delete order[mangaUrl];
      localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    } catch {}
  }
};
