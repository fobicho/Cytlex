export const lastSearch = { q: '', genre: '', results: null };

export const scrollMemory = { catalog: 0 };

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
