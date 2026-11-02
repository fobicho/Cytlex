const KEY = 'cytlex:progress:v1';

let cache = null;

const read = () => {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { cache = {}; }
  return cache;
};

const write = (data) => {
  cache = data;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
};

const cap = (url, sourceId = 'leercapitulo') => `${sourceId}|${url}`;

const listeners = new Set();
const notify = (change) => listeners.forEach((l) => l(change));

function put(url, sourceId, patch) {
  const data = read();
  const k = cap(url, sourceId);
  data[k] = { ...(data[k] || {}), ...patch };
  write(data);
}

export const progress = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  get(url, sourceId = 'leercapitulo') {
    return read()[cap(url, sourceId)] || null;
  },

  savePage(url, sourceId, page, total) {
    if (!url) return;
    if (!Number.isInteger(page) || page < 0) return;
    const cur = read()[cap(url, sourceId)];
    if (cur?.read) return;
    put(url, sourceId, { page, total: total ?? cur?.total ?? 0, updatedAt: Date.now() });
  },

  markRead(url, sourceId, total = 0, mangaUrl = '') {
    if (!url) return;
    const wasRead = read()[cap(url, sourceId)]?.read;
    put(url, sourceId, { page: null, total, read: true, readAt: Date.now() });
    if (!wasRead) notify({ type: 'read', mangaUrl, sourceId });
  },

  markMany(urls, sourceId, total = null, mangaUrl = '') {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return;
    const data = read();
    const now = Date.now();
    let changed = false;
    list.forEach((url) => {
      const key = cap(url, sourceId);
      const previous = data[key] || {};
      if (!previous.read) changed = true;
      data[key] = { ...previous, page: null, total: total ?? previous.total ?? 0, read: true, readAt: now };
    });
    write(data);
    if (changed) notify({ type: 'read', mangaUrl, sourceId });
  },

  markUnread(url, sourceId, mangaUrl = '') {
    if (!url) return;
    const cur = read()[cap(url, sourceId)];
    if (!cur) return;
    put(url, sourceId, { read: false, readAt: null, page: null });
    if (cur.read) notify({ type: 'read', mangaUrl, sourceId });
  },

  remove(url, sourceId, mangaUrl = '') {
    const data = read();
    const wasRead = data[cap(url, sourceId)]?.read;
    delete data[cap(url, sourceId)];
    write(data);
    if (wasRead) notify({ type: 'read', mangaUrl, sourceId });
  },

  reassignSource(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const data = read();
    const prefix = `${oldId}|`;
    let changed = false;
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith(prefix)) continue;
      const nextKey = `${newId}|${key.slice(prefix.length)}`;
      data[nextKey] = { ...(data[nextKey] || {}), ...value };
      delete data[key];
      changed = true;
    }
    if (changed) {
      write(data);
      notify({ type: 'reset', sourceId: newId });
    }
  }
};

