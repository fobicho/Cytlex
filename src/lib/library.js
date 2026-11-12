const FAV = 'cytlex:favs';
const CATS = 'cytlex:cats:v1';
let favoritesRaw;
let favoritesSnapshot;

const read = (k, fb) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const DEFAULT_CATS = [{ id: 'todos', name: 'Todos' }];

const uid = () => 'c' + Math.random().toString(36).slice(2, 9);

function loadCats() {
  const stored = read(CATS, null);
  if (Array.isArray(stored) && stored.length) return stored;
  const fresh = DEFAULT_CATS.map((c) => ({ ...c }));
  write(CATS, fresh);
  return fresh;
}

const sameUrl = (a, b) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameUrlKey(a) === sameUrlKey(b);
};

const sameUrlKey = (u) => String(u || '').replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '') || '/';
const libraryUrlKey = (url) => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const mangaDexId = host === 'mangadex.org'
      ? parsed.pathname.match(/^\/(?:title|manga)\/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})(?:\/|$)/i)?.[1]
      : '';
    if (mangaDexId) return `mangadex.org/title/${mangaDexId.toLowerCase()}`;
    return `${host}${parsed.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return sameUrlKey(url);
  }
};
export const libraryKey = (url, sourceId = 'leercapitulo') => {
  const identity = libraryUrlKey(url);
  return `${sourceId}|${identity.startsWith('mangadex.org/title/') ? identity : sameUrlKey(url)}`;
};
export const libraryIdentityKey = (url) => `url|${libraryUrlKey(url)}`;
export const mangaSourceUrl = (url, sourceId) => {
  if (sourceId !== 'mangadex' && sourceId !== 'mangadex-en') return url;
  const identity = libraryUrlKey(url);
  return identity.startsWith('mangadex.org/title/') ? `https://${identity}` : url;
};
export function isMangaCover(cover, mangaUrl) {
  const identity = libraryUrlKey(mangaUrl);
  if (!identity.startsWith('mangadex.org/title/')) return true;
  try {
    const image = new URL(cover);
    const host = image.hostname.replace(/^www\./, '');
    const coverId = image.pathname.match(/^\/covers\/([\da-f-]{36})\/[^/]+$/i)?.[1];
    return (image.protocol === 'https:' || image.protocol === 'http:')
      && (host === 'uploads.mangadex.org' || host === 'mangadex.org')
      && coverId?.toLowerCase() === identity.split('/').at(-1);
  } catch {
    return false;
  }
}
export const storedCoverThumbnail = (manga) =>
  manga && !libraryUrlKey(manga.url).startsWith('mangadex.org/title/')
    ? manga.coverCached || manga.coverLocal || ''
    : '';
export const isLibraryManga = (manga, sourceId, keys) =>
  keys.has(libraryKey(manga.url, sourceId))
  || keys.has(libraryIdentityKey(manga.url));

const SRC = (x) => x.sourceId || 'leercapitulo';
export const isUnresolvedMihonSource = (sourceId) => /^mihon-\d+$/i.test(String(sourceId || ''));
const match = (a, url, sourceId = 'leercapitulo') => {
  const savedSource = SRC(a);
  return (savedSource === sourceId && sameUrl(a.url, url))
    || ((savedSource === sourceId || isUnresolvedMihonSource(savedSource))
      && libraryUrlKey(a.url) === libraryUrlKey(url));
};

export const lib = {
  favs() {
    let raw = null;
    try { raw = localStorage.getItem(FAV); } catch {}
    if (raw !== favoritesRaw || !favoritesSnapshot) {
      let list = [];
      try { list = JSON.parse(raw) || []; } catch {}
      if (!Array.isArray(list)) list = [];
      if (list.some((f) => f.cats === undefined)) {
        const [first] = loadCats();
        list = list.map((f) => f.cats === undefined ? { ...f, cats: first ? [first.id] : [] } : f);
        raw = JSON.stringify(list);
        localStorage.setItem(FAV, raw);
      }
      favoritesRaw = raw;
      favoritesSnapshot = list;
    }
    return favoritesSnapshot.slice();
  },
  fav(url, sourceId = 'leercapitulo') {
    return lib.favs().find((f) => match(f, url, sourceId)) || null;
  },
  isFav(url, sourceId = 'leercapitulo') {
    return lib.favs().some((f) => match(f, url, sourceId));
  },
  toggleFav(manga, catIds) {
    const favs = lib.favs();
    const i = favs.findIndex((f) => match(f, manga.url, SRC(manga)));
    if (i >= 0) favs.splice(i, 1);
    else favs.unshift({ ...manga, cats: catIds || [], savedAt: Date.now() });
    write(FAV, favs);
    return favs;
  },
  updateFavCats(url, catIds, sourceId = 'leercapitulo') {
    const favs = lib.favs();
    const i = favs.findIndex((f) => match(f, url, sourceId));
    if (i >= 0) {
      favs[i] = { ...favs[i], cats: catIds };
      write(FAV, favs);
    }
    return favs;
  },
  updateFav(url, patch, sourceId = 'leercapitulo') {
    const favs = lib.favs();
    const i = favs.findIndex((f) => match(f, url, sourceId));
    if (i >= 0) {
      const coverChanged = typeof patch.cover === 'string' && patch.cover && patch.cover !== favs[i].cover;
      favs[i] = {
        ...favs[i],
        ...patch,
        ...(coverChanged ? { coverLocal: '', coverCached: '' } : {})
      };
      write(FAV, favs);
    }
    return favs;
  },
  updateFavs(updates) {
    const favs = lib.favs();
    const patches = new Map(updates.map(({ url, sourceId, patch }) => [`${sourceId || 'leercapitulo'}|${sameUrlKey(url)}`, patch]));
    let changed = false;
    const next = favs.map((f) => {
      const patch = patches.get(`${SRC(f)}|${sameUrlKey(f.url)}`);
      if (!patch) return f;
      changed = true;
      return { ...f, ...patch };
    });
    if (changed) write(FAV, next);
    return next;
  },

  cats() { return loadCats(); },
  addCat(name) {
    const cats = loadCats();
    cats.push({ id: uid(), name: name.trim() || 'Sin nombre' });
    write(CATS, cats);
    return cats;
  },
  renameCat(id, name) {
    const cats = loadCats();
    const i = cats.findIndex((c) => c.id === id);
    if (i >= 0) {
      cats[i] = { ...cats[i], name: name.trim() || cats[i].name };
      write(CATS, cats);
    }
    return cats;
  },
  countInCat(id) {
    return lib.favs().filter((f) => (f.cats || []).includes(id)).length;
  },
  removeCat(id) {
    let cats = loadCats().filter((c) => c.id !== id);
    if (!cats.length) cats = DEFAULT_CATS.map((c) => ({ ...c }));
    write(CATS, cats);
    const favs = lib.favs().map((f) => ({ ...f, cats: (f.cats || []).filter((c) => c !== id) }));
    write(FAV, favs);
    return cats;
  },
  removeFavs(mangas) {
    const drop = new Set(mangas.map((m) => `${SRC(m)}|${sameUrlKey(m.url)}`));
    const favs = lib.favs().filter((f) => !drop.has(`${SRC(f)}|${sameUrlKey(f.url)}`));
    write(FAV, favs);
    return favs;
  }
};

