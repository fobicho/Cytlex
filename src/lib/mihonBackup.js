import defaultExtensionIndex from '../../docs/index.json' with { type: 'json' };

const FAVORITES_KEY = 'cytlex:favs';
const CATEGORIES_KEY = 'cytlex:cats:v1';
const PROGRESS_KEY = 'cytlex:progress:v1';
const MAX_EXPANDED_SIZE = 250 * 1024 * 1024;
const MAX_ENTRIES = 100000;
const decoder = new TextDecoder();

function readVarint(bytes, state) {
  let value = 0n;
  let shift = 0n;
  for (let count = 0; count < 10; count += 1) {
    if (state.offset >= bytes.length) throw new Error('El respaldo de Mihon está incompleto.');
    const byte = bytes[state.offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
    shift += 7n;
  }
  throw new Error('El respaldo de Mihon contiene un número no válido.');
}

function fields(bytes) {
  const state = { offset: 0 };
  const result = [];
  while (state.offset < bytes.length) {
    const tag = readVarint(bytes, state);
    const number = Number(tag) >>> 3;
    const wire = Number(tag) & 7;
    if (!number) throw new Error('El respaldo de Mihon contiene un campo no válido.');
    if (wire === 0) result.push([number, readVarint(bytes, state)]);
    else if (wire === 1) {
      if (state.offset + 8 > bytes.length) throw new Error('El respaldo de Mihon está incompleto.');
      result.push([number, bytes.subarray(state.offset, state.offset + 8)]);
      state.offset += 8;
    } else if (wire === 2) {
      const length = Number(readVarint(bytes, state));
      if (!Number.isSafeInteger(length) || length < 0 || state.offset + length > bytes.length) {
        throw new Error('El respaldo de Mihon contiene un bloque incompleto.');
      }
      result.push([number, bytes.subarray(state.offset, state.offset + length)]);
      state.offset += length;
    } else if (wire === 5) {
      if (state.offset + 4 > bytes.length) throw new Error('El respaldo de Mihon está incompleto.');
      result.push([number, bytes.subarray(state.offset, state.offset + 4)]);
      state.offset += 4;
    } else {
      throw new Error('El respaldo de Mihon usa un formato no compatible.');
    }
  }
  return result;
}

function valueOf(list, field, fallback = '') {
  const found = list.find(([number]) => number === field);
  return found ? found[1] : fallback;
}

function stringsOf(list, field) {
  return list.filter(([number]) => number === field).map(([, value]) => decoder.decode(value));
}

function decodeChapter(bytes) {
  const list = fields(bytes);
  return {
    url: decoder.decode(valueOf(list, 1, new Uint8Array())),
    name: decoder.decode(valueOf(list, 2, new Uint8Array())),
    read: Boolean(valueOf(list, 4, 0)),
    page: Number(valueOf(list, 6, 0)) || 0
  };
}

function decodeManga(bytes) {
  const list = fields(bytes);
  const categoryIds = list.filter(([field]) => field === 17).flatMap(([, value]) => {
    if (typeof value === 'number' || typeof value === 'bigint') return [Number(value)];
    const packed = [];
    const state = { offset: 0 };
    while (state.offset < value.length) packed.push(Number(readVarint(value, state)));
    return packed;
  });
  return {
    source: Number(valueOf(list, 1, 0)),
    url: decoder.decode(valueOf(list, 2, new Uint8Array())),
    title: decoder.decode(valueOf(list, 3, new Uint8Array())),
    artist: decoder.decode(valueOf(list, 4, new Uint8Array())),
    author: decoder.decode(valueOf(list, 5, new Uint8Array())),
    description: decoder.decode(valueOf(list, 6, new Uint8Array())),
    genres: stringsOf(list, 7),
    status: Number(valueOf(list, 8, 0)),
    cover: decoder.decode(valueOf(list, 9, new Uint8Array())),
    favorite: Boolean(valueOf(list, 100, 1)),
    chapters: list.filter(([field]) => field === 16).map(([, value]) => decodeChapter(value)),
    categoryIds
  };
}

function decodeCategory(bytes) {
  const list = fields(bytes);
  return {
    name: decoder.decode(valueOf(list, 1, new Uint8Array())),
    order: Number(valueOf(list, 2, 0)),
    id: Number(valueOf(list, 3, 0))
  };
}

function decodeSource(bytes) {
  const list = fields(bytes);
  return { name: decoder.decode(valueOf(list, 1, new Uint8Array())), id: Number(valueOf(list, 2, 0)) };
}

function concatBytes(a, b) {
  if (!a.length) return b;
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

function tryReadVarint(bytes, offset) {
  let value = 0n;
  let shift = 0n;
  for (let count = 0; count < 10; count += 1) {
    if (offset + count >= bytes.length) return null;
    const byte = bytes[offset + count];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) return { value: Number(value), length: count + 1 };
    shift += 7n;
  }
  throw new Error('El respaldo de Mihon contiene un número no válido.');
}

async function* readTopLevel(stream) {
  const reader = stream.getReader();
  let buffer = new Uint8Array();
  let expanded = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      expanded += value.length;
      if (expanded > MAX_EXPANDED_SIZE) throw new Error('El respaldo descomprimido supera el límite de 250 MB.');
      buffer = concatBytes(buffer, value);
      let offset = 0;
      while (offset < buffer.length) {
        const tag = tryReadVarint(buffer, offset);
        if (!tag) break;
        const field = tag.value >>> 3;
        const wire = tag.value & 7;
        let next = offset + tag.length;
        if (wire === 2) {
          const size = tryReadVarint(buffer, next);
          if (!size) break;
          if (!Number.isSafeInteger(size.value) || size.value < 0 || size.value > 32 * 1024 * 1024) {
            throw new Error('El respaldo de Mihon contiene una entrada demasiado grande.');
          }
          next += size.length;
          if (next + size.value > buffer.length) break;
          if ([1, 2, 101].includes(field)) yield [field, buffer.slice(next, next + size.value)];
          next += size.value;
        } else if (wire === 0) {
          const value = tryReadVarint(buffer, next);
          if (!value) break;
          next += value.length;
        } else if (wire === 1 || wire === 5) {
          next += wire === 1 ? 8 : 4;
          if (next > buffer.length) break;
        } else {
          throw new Error('El respaldo de Mihon usa un formato no compatible.');
        }
        offset = next;
      }
      if (offset) buffer = buffer.slice(offset);
    }
    if (buffer.length) throw new Error('El respaldo de Mihon está incompleto o dañado.');
  } finally {
    reader.releaseLock();
  }
}

function normalizeName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sourceLookup(installedSources, mihonSources, availableExtensions) {
  const catalog = installedSources.map(({ manifest }) => ({ manifest, installed: true }));
  const knownIds = new Set(catalog.map(({ manifest }) => manifest.id));
  for (const extension of [...defaultExtensionIndex, ...availableExtensions]) {
    const subs = extension.config?.sources;
    const manifests = Array.isArray(subs) && subs.length
      ? subs.map((source) => ({ ...extension, ...source }))
      : [extension];
    for (const manifest of manifests) {
      if (!knownIds.has(manifest.id)) {
        knownIds.add(manifest.id);
        catalog.push({ manifest, installed: false });
      }
    }
  }
  const byName = new Map();
  for (const source of catalog) {
    const name = normalizeName(source.manifest.name);
    const candidates = byName.get(name) || [];
    candidates.push(source);
    byName.set(name, candidates);
  }
  const registry = new Map(mihonSources.map((source) => [source.id, source]));
  return (manga) => {
    const source = registry.get(manga.source);
    const normalizedSourceName = normalizeName(source?.name);
    const nameMatch = (() => {
      const exact = byName.get(normalizedSourceName) || [];
      const installedExact = exact.filter((entry) => entry.installed);
      if (installedExact.length === 1) return installedExact[0];
      if (exact.length === 1) return exact[0];
      if (normalizedSourceName.length < 4) return null;
      const matches = catalog.filter(({ manifest }) => {
        const normalizedName = normalizeName(manifest.name);
        return normalizedName.length >= 4
          && (normalizedSourceName.startsWith(normalizedName) || normalizedName.startsWith(normalizedSourceName));
      });
      const installedMatches = matches.filter((entry) => entry.installed);
      if (installedMatches.length === 1) return installedMatches[0];
      return matches.length === 1 ? matches[0] : null;
    })();
    if (nameMatch) return nameMatch;
    const rawUrl = manga.url;
    try {
      const host = new URL(rawUrl).hostname.toLowerCase();
      return catalog.find(({ manifest }) => {
        try { return new URL(manifest.baseUrl).hostname.toLowerCase() === host; } catch { return false; }
      }) || null;
    } catch {
      return null;
    }
  };
}

function resolveUrl(raw, manifest) {
  if (!raw) return '';
  try { return new URL(raw, manifest?.baseUrl).href; } catch { return raw; }
}

export async function previewMihonBackup(input, installedSources, availableExtensions = []) {
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let stream = new Blob([bytes]).stream();
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream !== 'function') throw new Error('Este entorno no puede descomprimir respaldos Mihon.');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const mangas = [];
  const categories = [];
  const sources = [];
  for await (const [field, value] of readTopLevel(stream)) {
    if (field === 1) {
      if (mangas.length >= MAX_ENTRIES) throw new Error('El respaldo de Mihon contiene demasiadas entradas.');
      mangas.push(decodeManga(value));
    } else if (field === 2) categories.push(decodeCategory(value));
    else if (field === 101) sources.push(decodeSource(value));
  }
  if (!mangas.length) throw new Error('El archivo no contiene mangas de un respaldo Mihon compatible.');
  const resolveSource = sourceLookup(installedSources, sources, availableExtensions);
  const orderedCategories = categories.slice().sort((a, b) => a.order - b.order);
  const categoryByIndex = new Map(orderedCategories.map((category, index) => [index, category.name]));
  const converted = mangas.filter((manga) => manga.favorite && manga.url && manga.title).map((manga) => {
    const resolvedSource = resolveSource(manga);
    const manifest = resolvedSource?.manifest;
    const source = sources.find((item) => item.id === manga.source);
    const sourceId = manifest?.id || `mihon-${manga.source}`;
    const url = resolveUrl(manga.url, manifest);
    const chapterProgress = manga.chapters.map((chapter) => ({
      url: resolveUrl(chapter.url, manifest),
      read: chapter.read,
      page: chapter.page
    })).filter((chapter) => chapter.url);
    return {
      manga: {
        url,
        sourceId,
        sourceName: source?.name || manifest?.name || `Fuente Mihon ${manga.source}`,
        sourceIcon: manifest?.icon || '',
        title: manga.title,
        author: manga.author || manga.artist,
        description: manga.description,
        genres: manga.genres,
        status: manga.status,
        cover: resolveUrl(manga.cover, manifest),
        cats: manga.categoryIds.map((index) => categoryByIndex.get(index)).filter(Boolean),
        savedAt: Date.now()
      },
      legacySourceId: `mihon-${manga.source}`,
      legacyUrl: manga.url,
      chapterProgress
    };
  });
  const installedIds = new Set(installedSources.map(({ manifest }) => manifest.id));
  const matched = converted.filter((entry) => installedIds.has(entry.manga.sourceId)).length;
  return {
    entries: converted,
    categoryNames: [...new Set(orderedCategories.map((category) => category.name).filter(Boolean))],
    mangaCount: converted.length,
    sourceCount: new Set(converted.map((entry) => entry.manga.sourceName)).size,
    unmatchedCount: converted.length - matched
  };
}

const readStored = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const makeId = () => `mihon-${Math.random().toString(36).slice(2, 10)}`;
const isPlaceholderSourceName = (value) => !value || /^mihon-\d+$/i.test(String(value)) || /^fuente mihon \d+$/i.test(String(value));
const urlKey = (value) => {
  try { return `${new URL(value).hostname.toLowerCase()}${new URL(value).pathname.replace(/\/+$/, '') || '/'}`; }
  catch { return String(value || '').replace(/\/+$/, '').toLowerCase(); }
};
const pathKey = (value) => {
  try { return new URL(value).pathname.replace(/\/+$/, '').toLowerCase() || '/'; }
  catch { return String(value || '').split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase() || '/'; }
};

export function importMihonBackup(candidate, { excludedEntries = [] } = {}) {
  const previous = Object.fromEntries([FAVORITES_KEY, CATEGORIES_KEY, PROGRESS_KEY].map((key) => [key, localStorage.getItem(key)]));
  const currentCategories = readStored(CATEGORIES_KEY, [{ id: 'todos', name: 'Todos' }]);
  const categories = Array.isArray(currentCategories) && currentCategories.length ? currentCategories : [{ id: 'todos', name: 'Todos' }];
  const categoryIds = new Map(categories.map((category) => [normalizeName(category.name), category.id]));
  candidate.categoryNames.forEach((name) => {
    const key = normalizeName(name);
    if (key && !categoryIds.has(key)) {
      const id = makeId();
      categories.push({ id, name });
      categoryIds.set(key, id);
    }
  });
  const storedFavorites = readStored(FAVORITES_KEY, []);
  const excludedKeys = new Set(excludedEntries.flatMap((entry) => [
    `${entry.manga.sourceId}|${urlKey(entry.manga.url)}`,
    `${entry.legacySourceId}|${pathKey(entry.legacyUrl)}`
  ]));
  const favorites = (Array.isArray(storedFavorites) ? storedFavorites : []).filter((manga) => {
    const sourceId = manga.sourceId || 'leercapitulo';
    if (excludedKeys.has(`${sourceId}|${urlKey(manga.url)}`)) return false;
    return !String(sourceId).startsWith('mihon-') || !excludedKeys.has(`${sourceId}|${pathKey(manga.url)}`);
  });
  const byManga = new Map();
  favorites.forEach((manga, index) => {
    byManga.set(`${manga.sourceId || 'leercapitulo'}|${urlKey(manga.url)}`, index);
    if (String(manga.sourceId || '').startsWith('mihon-')) {
      byManga.set(`${manga.sourceId}|${pathKey(manga.url)}`, index);
    }
  });
  const previousMihonCategoryIds = new Set(candidate.categoryNames.map((name) => categoryIds.get(normalizeName(name))).filter(Boolean));
  const defaultCategoryId = categories.find((category) => normalizeName(category.name) === 'todos')?.id;
  const storedProgress = readStored(PROGRESS_KEY, {});
  const progress = storedProgress && typeof storedProgress === 'object' && !Array.isArray(storedProgress) ? storedProgress : {};
  let added = 0;
  let updated = 0;
  for (const entry of candidate.entries.filter((item) => !excludedEntries.includes(item))) {
    const manga = entry.manga;
    manga.cats = [...new Set(manga.cats.map((name) => categoryIds.get(normalizeName(name))).filter(Boolean))];
    if (!manga.cats.length && categories[0]?.id) manga.cats = [categories[0].id];
    const key = `${manga.sourceId}|${urlKey(manga.url)}`;
    const legacyKey = `${entry.legacySourceId}|${pathKey(entry.legacyUrl)}`;
    const originalKey = entry.originalUrl ? `${manga.sourceId}|${urlKey(entry.originalUrl)}` : '';
    const index = byManga.get(key) ?? (originalKey ? byManga.get(originalKey) : undefined) ?? byManga.get(legacyKey);
    if (index === undefined) {
      byManga.set(key, favorites.length);
      if (originalKey) byManga.set(originalKey, favorites.length);
      byManga.set(legacyKey, favorites.length);
      favorites.push(manga);
      added += 1;
    } else {
      const existing = favorites[index];
      const existingCats = Array.isArray(existing.cats) ? existing.cats : [];
      const keptCategories = existingCats.filter((id) => !previousMihonCategoryIds.has(id)
        && !(defaultCategoryId === id && manga.cats.length));
      favorites[index] = {
        ...manga,
        ...existing,
        sourceId: manga.sourceId,
        sourceName: isPlaceholderSourceName(existing.sourceName) ? manga.sourceName : existing.sourceName,
        sourceIcon: existing.sourceIcon || manga.sourceIcon,
        url: manga.url,
        title: existing.title || manga.title,
        author: existing.author || manga.author,
        description: existing.description || manga.description,
        genres: existing.genres?.length ? existing.genres : manga.genres,
        cover: manga.cover || existing.cover,
        coverLocal: manga.cover ? '' : existing.coverLocal || '',
        cats: [...new Set([...keptCategories, ...manga.cats])]
      };
      byManga.set(key, index);
      if (originalKey) byManga.set(originalKey, index);
      byManga.set(legacyKey, index);
      updated += 1;
    }
    for (const chapter of entry.chapterProgress) {
      const chapterKey = `${manga.sourceId}|${chapter.url}`;
      const old = progress[chapterKey] || {};
      delete progress[chapterKey];
      if (chapter.read) {
        progress[chapterKey] = { ...old, page: null, total: old.total || 0, read: true, readAt: old.readAt || Date.now() };
      } else if (chapter.page > 0) {
        progress[chapterKey] = { ...old, page: chapter.page, total: old.total || 0, read: false, updatedAt: old.updatedAt || Date.now() };
      }
    }
  }
  const defaultCategory = categories.find((category) => category.id === 'todos' && normalizeName(category.name) === 'todos');
  if (candidate.categoryNames.length && defaultCategory) {
    categories.splice(categories.indexOf(defaultCategory), 1);
    favorites.forEach((manga) => {
      manga.cats = (manga.cats || []).filter((categoryId) => categoryId !== defaultCategory.id);
    });
  }
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    throw error;
  }
  return { added, updated };
}
