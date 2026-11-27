import { comickSession } from './comickSession.js';

const API = 'https://api.comick.dev/integrations/v1';
const CACHE_MS = 30_000;
let libraryCache = null;
let libraryCacheAt = 0;
let libraryPromise = null;

export const COMICK_STATUS = {
  1: 'Leyendo',
  2: 'Completado',
  3: 'En pausa',
  4: 'Abandonado',
  5: 'Planeando'
};

function unwrap(response) {
  if (!response || !Object.hasOwn(response, 'data')) return response;
  return response.data;
}

export const comickList = {
  async myLibrary({ fresh = false } = {}) {
    if (!fresh && libraryCache && Date.now() - libraryCacheAt < CACHE_MS) return libraryCache;
    if (libraryPromise) return libraryPromise;
    libraryPromise = (async () => {
      const items = [];
      let cursor = null;
      do {
        const url = new URL(`${API}/me/library`);
        url.searchParams.set('media_type', 'manga');
        url.searchParams.set('limit', '100');
        if (cursor) url.searchParams.set('cursor', cursor);
        const page = await comickSession.request(url.toString());
        if (!Array.isArray(page?.data)) throw new Error('Comick devolvió una biblioteca con un formato inesperado.');
        items.push(...page.data);
        cursor = page.next_cursor || null;
      } while (cursor);
      libraryCache = items;
      libraryCacheAt = Date.now();
      return items;
    })().finally(() => { libraryPromise = null; });
    return libraryPromise;
  },

  async entry(hid) {
    if (!hid) return null;
    return unwrap(await comickSession.request(`/me/library/${encodeURIComponent(hid)}`));
  },

  async saveEntry({ hid, status, progress } = {}) {
    if (!hid) throw new Error('Falta el identificador del manga en Comick.');
    const body = {};
    if (status != null) {
      const value = Number(status);
      if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error('El estado de Comick no es válido.');
      body.status = value;
    }
    if (progress !== undefined) {
      if (progress === null) body.progress = null;
      else if (typeof progress === 'object') {
        const number = String(progress.number ?? '').trim();
        if (number) body.progress = { number, ...(progress.volume != null ? { volume: String(progress.volume) } : {}) };
      } else {
        const number = String(progress).trim();
        if (number) body.progress = { number };
      }
    }
    if (!Object.keys(body).length) return this.entry(hid);
    const result = unwrap(await comickSession.request(`/me/library/${encodeURIComponent(hid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }));
    this.clearLibrary();
    return result;
  },

  clearLibrary() {
    libraryCache = null;
    libraryCacheAt = 0;
  }
};
