import { extensions } from './extensions.js';

function bridge() {
  if (typeof window !== 'undefined' && window.cytlex) return window.cytlex;
  return null;
}

function notInstalledError(id) {
  return new Error(
    id ? `La extensión «${id}» no está instalada.` : 'No hay ninguna fuente seleccionada.'
  );
}

async function resolveSource(sourceId) {
  if (!sourceId || !extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
  return extensions.source(sourceId);
}

const DETAIL_TTL_MS = 10 * 60 * 1000;
const CHAPTER_TTL_MS = 2 * 60 * 1000;
const CHAPTER_CACHE_MAX = 40;

const detailCache = new Map();
const chapterCache = new Map();
const chapterRequests = new Map();
const detailKey = (url, sourceId) => `${sourceId}|${url}`;
const chapterKey = (url, sourceId) => `${sourceId}|${extensions.manifest(sourceId)?.version || '0'}|${url}`;

const freshEntry = (key) => {
  const hit = detailCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DETAIL_TTL_MS) {
    detailCache.delete(key);
    return null;
  }
  return hit.value;
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

  async detail(url, sourceId) {
    const key = detailKey(url, sourceId);
    const hit = freshEntry(key);
    if (hit) return hit;
    const src = await resolveSource(sourceId);
    const result = await src.detail(url);
    detailCache.set(key, { at: Date.now(), value: result });
    return result;
  },

  async chapter(url, sourceId) {
    if (!extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
    const key = chapterKey(url, sourceId);
    const hit = chapterCache.get(key);
    if (hit && Date.now() - hit.at <= CHAPTER_TTL_MS) {
      chapterCache.delete(key);
      chapterCache.set(key, hit);
      return hit.value;
    }
    if (hit) chapterCache.delete(key);
    if (chapterRequests.has(key)) return chapterRequests.get(key);

    const request = resolveSource(sourceId).then((src) => src.chapter(url));
    chapterRequests.set(key, request);
    try {
      const value = await request;
      chapterCache.set(key, { at: Date.now(), value });
      while (chapterCache.size > CHAPTER_CACHE_MAX) {
        chapterCache.delete(chapterCache.keys().next().value);
      }
      return value;
    } finally {
      if (chapterRequests.get(key) === request) chapterRequests.delete(key);
    }
  },

  prefetchDetail(url, sourceId) {
    const key = detailKey(url, sourceId);
    if (freshEntry(key) || !sourceId) return;
    try {
      resolveSource(sourceId)
        .then((src) => src.detail(url))
        .then((r) => detailCache.set(key, { at: Date.now(), value: r }))
        .catch(() => {});
    } catch {}
  },

  clearDetailCache() { detailCache.clear(); }
};

