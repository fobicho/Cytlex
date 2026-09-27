import { extensions } from './extensions.js';

function bridge() {
  if (typeof window !== 'undefined' && window.cytlex) return window.cytlex;
  return null;
}

function noBridgeError() {
  return new Error(
    'Sin puente Electron (window.cytlex no existe). Abre la app con "npm run dev:electron" en lugar de solo "npm run dev".'
  );
}

function notInstalledError(id) {
  return new Error(
    id ? `La extensión «${id}» no está instalada.` : 'No hay ninguna fuente seleccionada.'
  );
}

async function resolveSource(sourceId) {
  if (!sourceId || !extensions.isInstalled(sourceId)) throw notInstalledError(sourceId);
  if (extensions.isNative(sourceId)) {
    const b = bridge();
    if (!b) throw noBridgeError();
    return b;
  }
  return extensions.source(sourceId);
}

const detailCache = new Map();
const detailKey = (url, sourceId) => `${sourceId}|${url}`;

export const api = {
  isBridgeOk() { return !!bridge(); },

  async home() {
    const b = bridge();
    if (!b) throw noBridgeError();
    return b.home();
  },

  async catalog(args, sourceId) {
    const src = await resolveSource(sourceId);
    return src.catalog(args);
  },

  async detail(url, sourceId) {
    const key = detailKey(url, sourceId);
    if (detailCache.has(key)) return detailCache.get(key);
    const src = await resolveSource(sourceId);
    const result = await src.detail(url);
    detailCache.set(key, result);
    return result;
  },

  async chapter(url, sourceId) {
    const src = await resolveSource(sourceId);
    return src.chapter(url);
  },

  prefetchDetail(url, sourceId) {
    const key = detailKey(url, sourceId);
    if (detailCache.has(key) || !sourceId) return;
    try { resolveSource(sourceId).then((src) => src.detail(url)).then((r) => detailCache.set(key, r)).catch(() => {}); } catch {}
  },

  clearDetailCache() { detailCache.clear(); }
};
