export const lastSearch = { q: '', genre: '', results: null };

export const scrollMemory = { catalog: 0 };

const SCROLL_KEY = 'cytlex:detailScroll:v2';

const readScroll = () => {
  try { return JSON.parse(localStorage.getItem(SCROLL_KEY)) || {}; } catch { return {}; }
};

// Guarda la posición exacta del scroll de la lista de capítulos, por manga.
export const detailScroll = {
  get(mangaUrl) {
    return readScroll()[mangaUrl || ''] ?? 0;
  },
  set(mangaUrl, top) {
    if (!mangaUrl || !top) return;
    try {
      localStorage.setItem(SCROLL_KEY, JSON.stringify({ ...readScroll(), [mangaUrl]: top }));
    } catch {}
  }
};

const ORDER_KEY = 'cytlex:chapterOrder:v2';

const readOrder = () => {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || {}; } catch { return {}; }
};

export const chapterOrder = {
  get(mangaUrl) {
    return readOrder()[mangaUrl || ''] === 'asc';
  },
  set(mangaUrl, asc) {
    if (!mangaUrl) return;
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify({ ...readOrder(), [mangaUrl]: asc ? 'asc' : 'desc' }));
    } catch {}
  }
};

const coverOkCache = new Set();

export function testCover(url) {
  if (!url) return Promise.resolve(false);
  if (coverOkCache.has(url)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      if (ok) coverOkCache.add(url);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 8000);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}
