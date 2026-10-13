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

  link(mangaUrl, sourceId, anilistId, cover) {
    if (!mangaUrl || !anilistId) return;
    const data = read();
    data[cap(mangaUrl, sourceId)] = {
      id: anilistId,
      linkedAt: Date.now(),
      ...(cover ? { cover } : {})
    };
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

  linkedCount() {
    return Object.keys(read()).length;
  }
};
