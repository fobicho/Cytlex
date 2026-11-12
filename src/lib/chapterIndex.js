const KEY = 'cytlex:chapterIndex:v1';
const TTL_MS = 6 * 60 * 60 * 1000;

let cache = null;
const listeners = new Set();

const read = () => {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { cache = {}; }
  return cache;
};

const write = (data, change = { type: 'reset' }) => {
  cache = data;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  listeners.forEach((l) => l(change));
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
    const resolvedSourceId = sourceId || 'leercapitulo';
    const data = read();
    const key = cap(url, resolvedSourceId);
    const current = data[key];
    const now = Date.now();
    if (current && now - current.at <= TTL_MS && current.urls?.length === urls.length
      && urls.every((chapterUrl, index) => chapterUrl === current.urls[index])) return;
    data[key] = { urls, at: now };
    write(data, { type: 'set', mangaUrl: url, sourceId: resolvedSourceId });
  },

  drop(url, sourceId) {
    const resolvedSourceId = sourceId || 'leercapitulo';
    const data = read();
    delete data[cap(url, resolvedSourceId)];
    write(data, { type: 'drop', mangaUrl: url, sourceId: resolvedSourceId });
  },

  dropSource(sourceId) {
    if (!sourceId) return;
    const data = read();
    const prefix = `${sourceId}|`;
    let changed = false;
    for (const key of Object.keys(data)) {
      if (key.startsWith(prefix)) { delete data[key]; changed = true; }
    }
    if (changed) write(data);
  },

  reassignSource(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const data = read();
    const prefix = `${oldId}|`;
    let changed = false;
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith(prefix)) continue;
      const nextKey = `${newId}|${key.slice(prefix.length)}`;
      if (!data[nextKey]) data[nextKey] = value;
      delete data[key];
      changed = true;
    }
    if (changed) write(data);
  },

  clear() { write({}); }
};
