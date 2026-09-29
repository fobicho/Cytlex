const FAV = 'cytlex:favs';
const CATS = 'cytlex:cats:v1';

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
  const strip = (u) => String(u).replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '') || '/';
  return strip(a) === strip(b);
};

const SRC = (x) => x.sourceId || 'leercapitulo';
const match = (a, url, sourceId = 'leercapitulo') => sameUrl(a.url, url) && SRC(a) === sourceId;

export const lib = {
  favs() {
    const stored = read(FAV, []);
    const cats = loadCats();
    let changed = false;
    const list = stored.map((f) => {
      if (f.cats === undefined) {
        changed = true;
        return { ...f, cats: cats[0] ? [cats[0].id] : [] };
      }
      return f;
    });
    if (changed) write(FAV, list);
    return list;
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
      favs[i] = { ...favs[i], ...patch };
      write(FAV, favs);
    }
    return favs;
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
  removeCat(id) {
    let cats = loadCats().filter((c) => c.id !== id);
    if (!cats.length) cats = DEFAULT_CATS.map((c) => ({ ...c }));
    write(CATS, cats);
    const favs = lib.favs().map((f) => ({ ...f, cats: (f.cats || []).filter((c) => c !== id) }));
    write(FAV, favs);
    return cats;
  }
};

