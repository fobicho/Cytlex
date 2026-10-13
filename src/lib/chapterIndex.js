const KEY = 'cytlex:chapterIndex:v1';
const TTL_MS = 6 * 60 * 60 * 1000;

let cache = null;
const listeners = new Set();

const read = () => {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { cache = {}; }
  return cache;
};

const write = (data) => {
  cache = data;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  listeners.forEach((l) => l());
};

const cap = (url, sourceId = 'leercapitulo') => `${sourceId}|${url}`;

export const chapterIndex = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  get(url, sourceId) {
    const e = read()[cap(url, sourceId)];
    if (!e) return null;
    if (Date.now() - e.at > TTL_MS) return null;
    return e.urls || null;
  },

  peek(url, sourceId) {
    return read()[cap(url, sourceId)]?.urls || null;
  },

  set(url, sourceId, urls) {
    if (!url || !Array.isArray(urls)) return;
    const data = read();
    data[cap(url, sourceId)] = { urls, at: Date.now() };
    write(data);
  },

  drop(url, sourceId) {
    const data = read();
    delete data[cap(url, sourceId)];
    write(data);
  },

  clear() { write({}); }
};
