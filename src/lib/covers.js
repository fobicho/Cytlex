const THUMB_WIDTH = 240;
const SEARCH_THUMB_WIDTH = 320;
const MAX_DATAURL = 120000;
const MAX_SEARCH_COVER_LOADS = 2;
const MAX_SEARCH_COVERS = 60;
const searchCoverCache = new Map();
const searchCoverWaiters = [];
let searchCoverGeneration = 0;
let activeSearchCoverLoads = 0;

function pruneSearchCoverCache() {
  while (searchCoverCache.size > MAX_SEARCH_COVERS) {
    const [url, value] = searchCoverCache.entries().next().value;
    searchCoverCache.delete(url);
    if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
  }
}

async function acquireSearchCoverSlot() {
  if (activeSearchCoverLoads < MAX_SEARCH_COVER_LOADS) activeSearchCoverLoads += 1;
  else await new Promise((resolve) => searchCoverWaiters.push(resolve));
}

function releaseSearchCoverSlot() {
  const next = searchCoverWaiters.shift();
  if (next) next();
  else activeSearchCoverLoads -= 1;
}

export function clearSearchCoverCache() {
  searchCoverGeneration += 1;
  for (const value of searchCoverCache.values()) {
    if (typeof value === 'string' && value.startsWith('blob:')) URL.revokeObjectURL(value);
  }
  searchCoverCache.clear();
}

export function getSearchCover(url) {
  const cached = searchCoverCache.get(url || '');
  return typeof cached === 'string' ? cached : '';
}

export function preloadSearchCover(url) {
  if (!url || typeof window === 'undefined' || !window.cytlex?.fetchImage) return Promise.resolve('');
  const cached = searchCoverCache.get(url);
  if (cached) return Promise.resolve(cached);

  const generation = searchCoverGeneration;
  const pending = (async () => {
    let timer;
    let acquired = false;
    try {
      await acquireSearchCoverSlot();
      acquired = true;
      if (generation !== searchCoverGeneration) return '';
      const thumbnail = await Promise.race([
        makeCoverThumb(url, SEARCH_THUMB_WIDTH),
        new Promise((resolve) => { timer = setTimeout(() => resolve(''), 8000); })
      ]);
      if (!thumbnail) return '';
      const blob = await (await fetch(thumbnail)).blob();
      const objectUrl = URL.createObjectURL(blob);
      if (generation !== searchCoverGeneration) {
        URL.revokeObjectURL(objectUrl);
        return '';
      }
      searchCoverCache.set(url, objectUrl);
      pruneSearchCoverCache();
      return objectUrl;
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
      if (acquired) releaseSearchCoverSlot();
    }
  })();
  searchCoverCache.set(url, pending);
  pruneSearchCoverCache();
  return pending;
}

export async function makeCoverThumb(url, maxWidth = THUMB_WIDTH) {
  if (typeof window === 'undefined' || !window.cytlex?.fetchImage || !url) return '';
  try {
    const fetched = await window.cytlex.fetchImage(url);
    if (!fetched?.base64) return '';

    const blob = await (await fetch(`data:${fetched.mime};base64,${fetched.base64}`)).blob();
    const objUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = objUrl;
      });
      if (!img.width) return '';

      const width = Math.min(maxWidth, img.width);
      const height = Math.max(1, Math.round((img.height / img.width) * width));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      return dataUrl.length <= MAX_DATAURL ? dataUrl : '';
    } finally {
      URL.revokeObjectURL(objUrl);
    }
  } catch {
    return '';
  }
}

