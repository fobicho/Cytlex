import { extensions, isExtensionAllowed, isSourceConfigured } from './extensions.js';
import { settings } from './settings.js';
import { lib, mangaSourceUrl } from './library.js';
import { deleteSourceCache, listSourceCache, readSourceCache, writeSourceCache } from './sourceCache.js';

function bridge() {
  if (typeof window !== 'undefined' && window.cytlex) return window.cytlex;
  return null;
}

function notInstalledError(id) {
  return new Error(
    id ? `La extensión «${id}» no está instalada.` : 'No hay ninguna fuente seleccionada.'
  );
}

function assertSourceEnabled(sourceId) {
  const source = extensions.manifest(sourceId);
  if (!isSourceConfigured(source)) {
    throw new Error(`La fuente «${source.name || sourceId}» está desactivada. Activa un idioma en Ajustes > Extensiones para usarla.`);
  }
  if (!isExtensionAllowed(source, settings.get().showAdultExtensions)) {
    throw new Error('Esta extensión está desactivada. Activa «Mostrar extensiones +18» en Ajustes > Extensiones para usarla.');
  }
}

async function resolveSource(sourceId, { allowDisabled = false } = {}) {
  if (!sourceId || !extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
  if (!allowDisabled) assertSourceEnabled(sourceId);
  return extensions.source(sourceId);
}

const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_CACHE_MAX = 40;
const DETAIL_TIMEOUT_MS = 16000;
const DETAIL_NOT_FOUND_TTL_MS = 60 * 1000;
const CHAPTER_TTL_MS = 2 * 60 * 1000;
const CHAPTER_CACHE_MAX = 40;
const CATALOG_TTL_MS = 30 * 1000;
const PERSISTED_CATALOG_TTL_MS = 5 * 60 * 1000;
const CATALOG_FILTERS_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_CACHE_MAX = 80;

const detailCache = new Map();
const detailRequests = new Map();
const detailNotFound = new Map();
const chapterCache = new Map();
const chapterRequests = new Map();
const catalogCache = new Map();
const catalogRequests = new Map();
const catalogFiltersCache = new Map();
const isMangaDex = (sourceId) => sourceId === 'mangadex' || sourceId === 'mangadex-en';
const sourceCacheKey = (sourceId) => {
  const version = extensions.manifest(sourceId)?.version || '0';
  let languages;
  if (isMangaDex(sourceId)) {
    try { languages = JSON.parse(localStorage.getItem('cytlex:ext-config:v1'))?.[sourceId]?.languages; } catch {}
  }
  return JSON.stringify([sourceId, version, languages]);
};
const detailKey = (url, sourceId) => `${sourceCacheKey(sourceId)}|${mangaSourceUrl(url, sourceId)}`;
const libraryDetailKey = (url, sourceId) => JSON.stringify(['library-detail', sourceId, mangaSourceUrl(url, sourceId)]);
const chapterKey = (url, sourceId) => `${sourceId}|${extensions.manifest(sourceId)?.version || '0'}|${url}`;
const catalogKey = (args, sourceId) => {
  const params = Object.fromEntries(Object.entries(args || {}).filter(([key]) => key !== '__cytlexRequestId'));
  const orderedParams = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify([sourceCacheKey(sourceId), orderedParams]);
};
const titleKey = (value) => String(value || '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function libraryDetailIdentity(key) {
  try {
    const parsed = JSON.parse(key);
    if (Array.isArray(parsed) && parsed[0] === 'library-detail') return `${parsed[1]}|${parsed[2]}`;
  } catch {}
  const separator = key.lastIndexOf('|');
  if (separator < 0) return '';
  try {
    const sourceConfig = JSON.parse(key.slice(0, separator));
    return Array.isArray(sourceConfig) ? `${sourceConfig[0]}|${key.slice(separator + 1)}` : '';
  } catch {
    return '';
  }
}

async function withDetailDeadline(request) {
  let timer;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Cytlex agotó el tiempo de espera al cargar el manga.')), DETAIL_TIMEOUT_MS);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sameAuthor(expected, actual) {
  const expectedNames = String(expected || '').split(/[,;|&]|\s+y\s+/i).map((name) => name.trim()).filter(Boolean);
  const actualNames = String(actual || '').split(/[,;|&]|\s+y\s+/i).map((name) => name.trim()).filter(Boolean);
  if (!expectedNames.length || !actualNames.length) return true;
  return expectedNames.some((expectedName) => {
    const expectedParts = new Set(expectedName.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}]+/gu) || []);
    return actualNames.some((actualName) => {
      const actualParts = new Set(actualName.normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[\p{L}]+/gu) || []);
      const shared = [...expectedParts].filter((part) => actualParts.has(part)).length;
      return !expectedParts.size || !actualParts.size || shared >= Math.min(2, expectedParts.size);
    });
  });
}

function matchesManga(detail, item, title, author) {
  const expectedTitle = titleKey(title);
  if (!expectedTitle) return false;
  const names = [detail?.title, detail?.altTitles, item?.title]
    .flatMap((value) => String(value || '').split(/[·•|;]/))
    .map(titleKey)
    .filter(Boolean);
  if (!names.includes(expectedTitle)) return false;
  return sameAuthor(author, [detail?.facts?.autor, item?.author].filter(Boolean).join(', '));
}

async function findManga(src, url, title, author) {
  const queries = [title, ...String(author || '').split(/[,;|&]|\s+y\s+/i)];
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = parts.at(-1)?.replace(/[-_]+/g, ' ').trim();
    if (slug && titleKey(slug) !== titleKey(title)) queries.push(slug);
  } catch {}
  const uniqueQueries = [...new Map(queries.filter(Boolean).map((query) => [titleKey(query), query])).values()];
  const seen = new Set();
  for (const query of uniqueQueries) {
    let items = [];
    try { items = (await src.catalog({ q: query, page: 1 })).items || []; } catch { continue; }
    const candidates = items.filter((item) => item.url && item.url !== url && !seen.has(item.url)).slice(0, 20);
    candidates.forEach((item) => seen.add(item.url));
    let cursor = 0;
    let found = null;
    const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
      while (cursor < candidates.length && !found) {
        const item = candidates[cursor++];
        try {
          const detail = await src.detail(item.url);
          if (matchesManga(detail, item, title, author)) found = { url: item.url, detail };
        } catch {}
      }
    });
    await Promise.all(workers);
    if (found) return found;
  }
  return null;
}

function catalogFiltersFor(sourceId, src) {
  if (typeof src.catalogFilters !== 'function') return Promise.resolve([]);
  const key = `${sourceId}|${extensions.manifest(sourceId)?.version || '0'}`;
  if (!catalogFiltersCache.has(key)) {
    const request = (async () => {
      const saved = await readSourceCache('catalog-filters', key);
      if (Array.isArray(saved?.value) && Date.now() - saved.at >= 0 && Date.now() - saved.at <= CATALOG_FILTERS_TTL_MS) {
        return saved.value;
      }
      const filters = await src.catalogFilters();
      if (Array.isArray(filters)) await writeSourceCache('catalog-filters', key, filters, 100);
      return filters;
    })().catch((error) => {
      catalogFiltersCache.delete(key);
      throw error;
    });
    catalogFiltersCache.set(key, request);
  }
  return catalogFiltersCache.get(key);
}

const freshEntry = (key) => {
  const hit = detailCache.get(key);
  if (!hit || Date.now() - hit.at > DETAIL_TTL_MS) return null;
  detailCache.delete(key);
  detailCache.set(key, hit);
  return hit.value;
};

const pruneCache = (cache, ttl, max) => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.at > ttl) cache.delete(key);
  }
  while (cache.size > max) cache.delete(cache.keys().next().value);
};

const storeDetail = (key, value, at = Date.now()) => {
  detailCache.delete(key);
  detailCache.set(key, { at, value });
  while (detailCache.size > DETAIL_CACHE_MAX) detailCache.delete(detailCache.keys().next().value);
};

export const api = {
  isBridgeOk() { return !!bridge(); },

  peekDetail(url, sourceId) {
    return freshEntry(detailKey(url, sourceId));
  },

  peekStaleDetail(url, sourceId) {
    return detailCache.get(detailKey(url, sourceId))?.value || null;
  },

  async restoreDetail(url, sourceId) {
    const key = detailKey(url, sourceId);
    if (lib.isFav(url, sourceId)) {
      const stableKey = libraryDetailKey(url, sourceId);
      const stable = await readSourceCache('library-details', stableKey);
      if (stable?.value?.chapters?.length) return stable.value;

      const legacyEntries = await listSourceCache('library-details');
      const legacy = legacyEntries.find((entry) => libraryDetailIdentity(entry.key) === `${sourceId}|${mangaSourceUrl(url, sourceId)}`
        && entry.value?.chapters?.length);
      if (legacy) {
        await writeSourceCache('library-details', stableKey, legacy.value, 1000);
        return legacy.value;
      }

      const legacyDetails = (await listSourceCache('details')).find((entry) =>
        libraryDetailIdentity(entry.key) === `${sourceId}|${mangaSourceUrl(url, sourceId)}`
        && entry.value?.chapters?.length
        && Date.now() - entry.at >= 0
        && Date.now() - entry.at <= DETAIL_TTL_MS
      );
      if (legacyDetails) {
        await writeSourceCache('library-details', stableKey, legacyDetails.value, 1000);
        return legacyDetails.value;
      }
    }
    const entry = lib.isFav(url, sourceId)
      ? await readSourceCache('library-details', key) || await readSourceCache('details', key)
      : await readSourceCache('details', key);
    return entry?.value || null;
  },

  async catalog(args, sourceId) {
    const src = await resolveSource(sourceId);
    const browser = !bridge()?.httpGet;
    const key = browser ? catalogKey(args, sourceId) : '';
    const { q = '', page = 1, genre = '', year = '', status = '', type = '', sort = '' } = args || {};
    const searchKey = isMangaDex(sourceId)
      ? JSON.stringify([sourceCacheKey(sourceId), q, page, genre, year, status, type, sort])
      : key;
    if (browser) {
      const hit = catalogCache.get(key);
      if (hit && Date.now() - hit.at <= CATALOG_TTL_MS) {
        catalogCache.delete(key);
        catalogCache.set(key, hit);
        return hit.value;
      }
      if (hit) catalogCache.delete(key);
      if (catalogRequests.has(key)) return catalogRequests.get(key);
    }

    const request = (async () => {
      const saved = browser ? await readSourceCache('searches', searchKey) : null;
      const savedAge = Date.now() - (saved?.at || 0);
      if (saved?.value?.items && savedAge >= 0 && savedAge <= PERSISTED_CATALOG_TTL_MS) return saved.value;
      try {
        return await src.catalog(args);
      } catch (error) {
        if (isMangaDex(sourceId) && /\b(?:ENOTFOUND|HTTP (?:429|50[234]))\b/.test(String(error?.message || error))) {
          if (saved?.value?.items?.length && savedAge <= 7 * 24 * 60 * 60 * 1000) return saved.value;
        }
        throw error;
      }
    })();

    if (browser) catalogRequests.set(key, request);
    try {
      const result = await request;
      if (browser && Array.isArray(result?.items)) {
        catalogCache.set(key, { at: Date.now(), value: result });
        while (catalogCache.size > CATALOG_CACHE_MAX) catalogCache.delete(catalogCache.keys().next().value);
        await writeSourceCache('searches', searchKey, result, 100);
      }
      return result;
    } finally {
      if (browser && catalogRequests.get(key) === request) catalogRequests.delete(key);
    }
  },

  async catalogFilters(sourceId) {
    const src = await resolveSource(sourceId);
    return catalogFiltersFor(sourceId, src);
  },

  async detail(url, sourceId, { cacheResult = true, persistResult = cacheResult, allowDisabled = false } = {}) {
    if (!sourceId || !extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
    if (!allowDisabled) assertSourceEnabled(sourceId);
    const key = detailKey(url, sourceId);
    const isFavorite = lib.isFav(url, sourceId);
    const hit = cacheResult ? freshEntry(key) : null;
    if (hit) {
      if (persistResult && !detailCache.get(key).persisted) {
        detailCache.get(key).persisted = true;
        void writeSourceCache('details', key, hit, DETAIL_CACHE_MAX);
      }
      if (isFavorite) void writeSourceCache('library-details', key, hit, 1000);
      return hit;
    }
    if (cacheResult) {
      if (isFavorite) {
        const pinned = await readSourceCache('library-details', key);
        if (pinned?.value?.chapters?.length) {
          storeDetail(key, pinned.value, pinned.at);
          detailCache.get(key).persisted = true;
          return pinned.value;
        }
      }
      const saved = await readSourceCache('details', key);
      if (saved?.value?.chapters?.length && Date.now() - saved.at >= 0 && Date.now() - saved.at <= DETAIL_TTL_MS) {
        storeDetail(key, saved.value, saved.at);
        detailCache.get(key).persisted = true;
        if (isFavorite) void writeSourceCache('library-details', key, saved.value, 1000);
        return saved.value;
      }
    }
    const failed = detailNotFound.get(key);
    if (failed && Date.now() - failed.at < DETAIL_NOT_FOUND_TTL_MS) throw failed.error;
    if (failed) detailNotFound.delete(key);
    let request = detailRequests.get(key);
    if (!request) {
      request = withDetailDeadline((async () => {
        const src = await resolveSource(sourceId, { allowDisabled });
        return src.detail(mangaSourceUrl(url, sourceId));
      })());
      detailRequests.set(key, request);
    }
    try {
      const result = await request;
      if (cacheResult && result?.chapters?.length) {
        if (freshEntry(key) !== result) storeDetail(key, result);
        const entry = detailCache.get(key);
        if (persistResult && !entry.persisted) {
          entry.persisted = true;
          void writeSourceCache('details', key, result, DETAIL_CACHE_MAX);
        }
        if (isFavorite) void writeSourceCache('library-details', key, result, 1000);
      }
      return result;
    } catch (error) {
      if (/\bHTTP 404\b/.test(String(error?.message || error))) {
        detailNotFound.set(key, { at: Date.now(), error });
        while (detailNotFound.size > DETAIL_CACHE_MAX) detailNotFound.delete(detailNotFound.keys().next().value);
      }
      throw error;
    } finally {
      if (detailRequests.get(key) === request) detailRequests.delete(key);
    }
  },

  async refreshDetail(url, sourceId) {
    const src = await resolveSource(sourceId);
    const result = await withDetailDeadline(src.detail(mangaSourceUrl(url, sourceId)));
    if (result?.chapters?.length) {
      const key = detailKey(url, sourceId);
      storeDetail(key, result);
      detailCache.get(key).persisted = true;
      void writeSourceCache('details', key, result, DETAIL_CACHE_MAX);
      if (lib.isFav(url, sourceId)) void writeSourceCache('library-details', key, result, 1000);
    }
    return result;
  },

  persistLibraryDetail(url, sourceId, value) {
    if (!lib.isFav(url, sourceId) || !value?.chapters?.length) return;
    return writeSourceCache('library-details', libraryDetailKey(url, sourceId), value, 1000);
  },

  removeLibraryDetail(url, sourceId) {
    return Promise.all([
      deleteSourceCache('library-details', libraryDetailKey(url, sourceId)),
      deleteSourceCache('library-details', detailKey(url, sourceId))
    ]);
  },

  async pruneLibraryDetails(favorites = lib.favs()) {
    const retained = new Set(favorites.map((manga) => `${manga.sourceId || 'leercapitulo'}|${mangaSourceUrl(manga.url, manga.sourceId || 'leercapitulo')}`));
    const cached = await listSourceCache('library-details');
    await Promise.all(cached.filter((entry) => !retained.has(libraryDetailIdentity(entry.key)))
      .map((entry) => deleteSourceCache('library-details', entry.key)));
  },

  async findManga({ url, title, author = '' }, sourceId) {
    const versionKey = sourceCacheKey(sourceId);
    const src = await resolveSource(sourceId);
    const found = await withDetailDeadline(findManga(src, url, title, author));
    if (found?.detail?.chapters?.length && versionKey === sourceCacheKey(sourceId)) {
      const key = detailKey(found.url, sourceId);
      if (!freshEntry(key)) storeDetail(key, found.detail);
    }
    return found;
  },

  async chapter(url, sourceId, { fresh = false } = {}) {
    if (!extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
    assertSourceEnabled(sourceId);
    const key = chapterKey(url, sourceId);
    if (!fresh) {
      const hit = chapterCache.get(key);
      if (hit && Date.now() - hit.at <= CHAPTER_TTL_MS) {
        chapterCache.delete(key);
        chapterCache.set(key, hit);
        return hit.value;
      }
      if (hit) chapterCache.delete(key);
      if (chapterRequests.has(key)) return chapterRequests.get(key);
    }

    const request = resolveSource(sourceId).then((src) => src.chapter(url));
    chapterRequests.set(key, request);
    try {
      const value = await request;
      // No cachear resultados vacíos (bloqueos temporales del servidor dejan el índice venenoso).
      if (value?.pages?.length) {
        chapterCache.delete(key);
        chapterCache.set(key, { at: Date.now(), value });
        pruneCache(chapterCache, CHAPTER_TTL_MS, CHAPTER_CACHE_MAX);
      }
      return value;
    } finally {
      if (chapterRequests.get(key) === request) chapterRequests.delete(key);
    }
  },

  prefetchDetail(url, sourceId) {
    const key = detailKey(url, sourceId);
    if (freshEntry(key) || !sourceId) return;
    this.detail(url, sourceId, { persistResult: false }).catch(() => {});
  },

  clearDetailCache() {
    detailCache.clear();
    detailNotFound.clear();
  }
};

