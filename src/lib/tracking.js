const KEY = 'cytlex:tracking:v1';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};
const write = (v) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
};

const cap = (url, sourceId = 'leercapitulo') => `${sourceId}|${url}`;

const listeners = new Set();
const notify = () => listeners.forEach((l) => l());

export const tracking = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  get(mangaUrl, sourceId) {
    if (!mangaUrl) return null;
    return read()[cap(mangaUrl, sourceId)] || null;
  },

  link(mangaUrl, sourceId, anilistId, cover, coverLocal) {
    if (!mangaUrl || !anilistId) return;
    const data = read();
    data[cap(mangaUrl, sourceId)] = {
      id: anilistId,
      linkedAt: Date.now(),
      ...(cover ? { cover } : {}),
      ...(coverLocal ? { coverLocal } : {})
    };
    write(data);
    notify();
  },

  move(mangaUrl, nextUrl, sourceId) {
    if (!mangaUrl || !nextUrl || mangaUrl === nextUrl) return;
    const data = read();
    const currentKey = cap(mangaUrl, sourceId);
    const nextKey = cap(nextUrl, sourceId);
    if (!data[currentKey]) return;
    if (!data[nextKey]) data[nextKey] = data[currentKey];
    delete data[currentKey];
    write(data);
    notify();
  },

  updateCover(mangaUrl, sourceId, { cover, coverLocal } = {}) {
    if (!mangaUrl) return;
    const data = read();
    const k = cap(mangaUrl, sourceId);
    if (!data[k]) return;
    if (cover) data[k].cover = cover;
    if (coverLocal) data[k].coverLocal = coverLocal;
    write(data);
    notify();
  },

  unlink(mangaUrl, sourceId) {
    if (!mangaUrl) return;
    const data = read();
    delete data[cap(mangaUrl, sourceId)];
    write(data);
    notify();
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
    if (changed) {
      write(data);
      notify();
    }
  },

  linkedCount() {
    return Object.keys(read()).length;
  }
};
