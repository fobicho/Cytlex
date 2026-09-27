// Registro de lectura por capítulo: página donde se quedó, total de páginas y estado (en curso / leído).
const KEY = 'cytlex:progress:v1';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
};
const write = (data) => {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
};

const cap = (url, sourceId = 'leercapitulo') => `${sourceId}|${url}`;

const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

function put(url, sourceId, patch) {
  const data = read();
  const k = cap(url, sourceId);
  data[k] = { ...(data[k] || {}), ...patch };
  write(data);
  notify();
}

export const progress = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  // { page, total, read, readAt, updatedAt } | null
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

  markRead(url, sourceId, total = 0) {
    if (!url) return;
    put(url, sourceId, { page: null, total, read: true, readAt: Date.now() });
  },

  markMany(urls, sourceId, total = 0) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return;
    const data = read();
    const now = Date.now();
    list.forEach((url) => {
      data[cap(url, sourceId)] = { ...(data[cap(url, sourceId)] || {}), page: null, total, read: true, readAt: now };
    });
    write(data);
    notify();
  },

  markUnread(url, sourceId) {
    if (!url) return;
    const cur = read()[cap(url, sourceId)];
    if (!cur) return;
    put(url, sourceId, { read: false, readAt: null, page: null });
  },

  remove(url, sourceId) {
    const data = read();
    delete data[cap(url, sourceId)];
    write(data);
    notify();
  }
};
