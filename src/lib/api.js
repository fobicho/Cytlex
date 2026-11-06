import { extensions, isExtensionAllowed } from './extensions.js';
import { settings } from './settings.js';

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
  if (!isExtensionAllowed(extensions.manifest(sourceId), settings.get().showAdultExtensions)) {
    throw new Error('Esta extensión está desactivada. Activa «Mostrar extensiones +18» en Ajustes > Extensiones para usarla.');
  }
}

async function resolveSource(sourceId) {
  if (!sourceId || !extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
  assertSourceEnabled(sourceId);
  return extensions.source(sourceId);
}

const DETAIL_TTL_MS = 10 * 60 * 1000;
const DETAIL_CACHE_MAX = 40;
const DETAIL_NOT_FOUND_TTL_MS = 60 * 1000;
const CHAPTER_TTL_MS = 2 * 60 * 1000;
const CHAPTER_CACHE_MAX = 40;

const detailCache = new Map();
const detailRequests = new Map();
const detailNotFound = new Map();
const chapterCache = new Map();
const chapterRequests = new Map();
const catalogFiltersCache = new Map();
const detailKey = (url, sourceId) => `${sourceId}|${extensions.manifest(sourceId)?.version || '0'}|${url}`;
const chapterKey = (url, sourceId) => `${sourceId}|${extensions.manifest(sourceId)?.version || '0'}|${url}`;
const titleKey = (value) => String(value || '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

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
    const request = Promise.resolve().then(() => src.catalogFilters()).catch((error) => {
      catalogFiltersCache.delete(key);
      throw error;
    });
    catalogFiltersCache.set(key, request);
  }
  return catalogFiltersCache.get(key);
}

const freshEntry = (key) => {
  const hit = detailCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DETAIL_TTL_MS) {
    detailCache.delete(key);
    return null;
  }
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

const storeDetail = (key, value) => {
  detailCache.delete(key);
  detailCache.set(key, { at: Date.now(), value });
  pruneCache(detailCache, DETAIL_TTL_MS, DETAIL_CACHE_MAX);
};

export const api = {
  isBridgeOk() { return !!bridge(); },

  peekDetail(url, sourceId) {
    return freshEntry(detailKey(url, sourceId));
  },

  peekStaleDetail(url, sourceId) {
    return detailCache.get(detailKey(url, sourceId))?.value || null;
  },

  async catalog(args, sourceId) {
    const src = await resolveSource(sourceId);
    return src.catalog(args);
  },

  async catalogFilters(sourceId) {
    const src = await resolveSource(sourceId);
    return catalogFiltersFor(sourceId, src);
  },

  async detail(url, sourceId, { cacheResult = true } = {}) {
    if (!sourceId || !extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
    assertSourceEnabled(sourceId);
    const key = detailKey(url, sourceId);
    const hit = freshEntry(key);
    if (hit) return hit;
    const failed = detailNotFound.get(key);
    if (failed && Date.now() - failed.at < DETAIL_NOT_FOUND_TTL_MS) throw failed.error;
    if (failed) detailNotFound.delete(key);
    let request = detailRequests.get(key);
    if (!request) {
      request = (async () => {
        const src = await resolveSource(sourceId);
        return src.detail(url);
      })();
      detailRequests.set(key, request);
    }
    try {
      const result = await request;
      if (cacheResult) storeDetail(key, result);
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
    return src.detail(url);
  },

  async refreshManga(url, sourceId, { title = '', author = '' } = {}) {
    const src = await resolveSource(sourceId);
    try {
      return { url, detail: await src.detail(url) };
    } catch (error) {
      if (!/\bHTTP 404\b/.test(String(error?.message || error)) || !title) throw error;
      const replacement = await findManga(src, url, title, author);
      if (!replacement) throw error;
      return replacement;
    }
  },

  async findManga({ url, title, author = '' }, sourceId) {
    const src = await resolveSource(sourceId);
    return findManga(src, url, title, author);
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
      chapterCache.delete(key);
      chapterCache.set(key, { at: Date.now(), value });
      pruneCache(chapterCache, CHAPTER_TTL_MS, CHAPTER_CACHE_MAX);
      return value;
    } finally {
      if (chapterRequests.get(key) === request) chapterRequests.delete(key);
    }
  },

  prefetchDetail(url, sourceId) {
    const key = detailKey(url, sourceId);
    if (freshEntry(key) || !sourceId) return;
    this.detail(url, sourceId).catch(() => {});
  },

  clearDetailCache() {
    detailCache.clear();
    detailNotFound.clear();
  }
};

