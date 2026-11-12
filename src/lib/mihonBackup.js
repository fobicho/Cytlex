
const FAVORITES_KEY = 'cytlex:favs';
const CATEGORIES_KEY = 'cytlex:cats:v1';
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
  const chapterNumberField = valueOf(list, 9, null);
  const chapterNumber = chapterNumberField instanceof Uint8Array && chapterNumberField.length === 4
    ? new DataView(chapterNumberField.buffer, chapterNumberField.byteOffset, 4).getFloat32(0, true)
    : 0;
  const rawPage = Number(valueOf(list, 6, 0));
  return {
    url: decoder.decode(valueOf(list, 1, new Uint8Array())),
    name: decoder.decode(valueOf(list, 2, new Uint8Array())),
    read: Boolean(valueOf(list, 4, 0)),
    page: Number.isSafeInteger(rawPage) ? Math.max(0, rawPage) : 0,
    number: Number.isFinite(chapterNumber) ? chapterNumber : 0
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
    id: Number(valueOf(list, 3, 0)),
    hasId: list.some(([field]) => field === 3)
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

function normalizeMangaName(value) {
  return String(value || '').normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function sourceLookup(installedSources, mihonSources, availableExtensions) {
  const catalog = installedSources.map(({ manifest }) => ({ manifest, installed: true }));
  const knownIds = new Set(catalog.map(({ manifest }) => manifest.id));
  for (const extension of availableExtensions) {
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
      const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
      const matches = catalog.filter(({ manifest }) => {
        try { return new URL(manifest.baseUrl).hostname.toLowerCase().replace(/^www\./, '') === host; } catch { return false; }
      });
      const installedMatches = matches.filter((entry) => entry.installed);
      if (installedMatches.length === 1) return installedMatches[0];
      return matches.length === 1 ? matches[0] : null;
    } catch {
      return null;
    }
  };
}

function resolveUrl(raw, manifest, fallback) {
  if (!raw) return '';
  try { return new URL(raw, manifest?.baseUrl || fallback).href; } catch { return raw; }
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
  const categoryByIndex = new Map(orderedCategories.map((category, index) => [String(index), category.name]));
  const converted = mangas.filter((manga) => manga.favorite && manga.url && manga.title).map((manga) => {
    const resolvedSource = resolveSource(manga);
    const manifest = resolvedSource?.manifest;
    const source = sources.find((item) => item.id === manga.source);
    const sourceId = manifest?.id || `mihon-${manga.source}`;
    const url = resolveUrl(manga.url, manifest);
    const chapterProgress = manga.chapters.map((chapter) => ({
      url: resolveUrl(chapter.url, manifest, url),
      name: chapter.name,
      number: chapter.number,
      read: chapter.read,
      page: chapter.page
    })).filter((chapter) => chapter.url && (chapter.read || chapter.page > 0));
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
        cover: resolveUrl(manga.cover, manifest, url),
        chapterTotal: manga.chapters.length,
        chapterReadCount: manga.chapters.filter((chapter) => chapter.read).length,
        cats: manga.categoryIds.map((index) => categoryByIndex.get(String(index))).filter(Boolean),
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
const mangaIdentityKey = (manga) => {
  const source = normalizeName(manga.sourceName);
  const title = normalizeMangaName(manga.title);
  if (!source || !title) return '';
  return `${source}|${title}|${normalizeMangaName(manga.author)}`;
};
const mangaWorkKey = (manga) => {
  const title = normalizeMangaName(manga.title);
  return title ? `${title}|${normalizeMangaName(manga.author)}` : '';
};
const mangaTitleKey = (manga) => normalizeMangaName(manga.title);

function mergeDuplicateFavorite(kept, duplicate) {
  return {
    ...duplicate,
    ...kept,
    cover: kept.cover || duplicate.cover,
    coverLocal: kept.coverLocal || duplicate.coverLocal || '',
    chapterTotal: Math.max(Number(kept.chapterTotal) || 0, Number(duplicate.chapterTotal) || 0),
    mihonProgress: mergeChapterProgress(kept.mihonProgress, duplicate.mihonProgress),
    cats: [...new Set([...(kept.cats || []), ...(duplicate.cats || [])])]
  };
}

function chapterProgressKey(chapter) {
  const number = Number(chapter.number);
  const name = normalizeName(chapter.name);
  if (Number.isFinite(number) && number !== 0) return `number|${number}|${name}`;
  return `name|${name || pathKey(chapter.url)}`;
}

function mergeChapterProgress(...lists) {
  const merged = new Map();
  for (const chapter of lists.flat().filter(Boolean)) {
    const key = chapterProgressKey(chapter);
    const previous = merged.get(key);
    merged.set(key, {
      ...previous,
      ...chapter,
      read: !!(previous?.read || chapter.read),
      page: Math.max(Number(previous?.page) || 0, Number(chapter.page) || 0)
    });
  }
  return [...merged.values()];
}

export function importMihonBackup(candidate, { matchByWork = true } = {}) {
  const importableEntries = candidate.entries;
  const previous = Object.fromEntries([FAVORITES_KEY, CATEGORIES_KEY].map((key) => [key, localStorage.getItem(key)]));
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
  const importedCategories = [...new Map(candidate.categoryNames
    .map((name) => categoryIds.get(normalizeName(name)))
    .filter(Boolean)
    .map((id) => [id, categories.find((category) => category.id === id)])).values()];
  if (importedCategories.length) {
    const importedCategoryIds = new Set(importedCategories.map((category) => category.id));
    const firstImportedIndex = categories.findIndex((category) => importedCategoryIds.has(category.id));
    const before = categories.slice(0, firstImportedIndex).filter((category) => !importedCategoryIds.has(category.id));
    const after = categories.slice(firstImportedIndex).filter((category) => !importedCategoryIds.has(category.id));
    categories.splice(0, categories.length, ...before, ...importedCategories, ...after);
  }
  const currentFavorites = readStored(FAVORITES_KEY, []);
  const storedFavorites = Array.isArray(currentFavorites) ? currentFavorites : [];
  const incomingIdentityKeys = new Set((matchByWork ? importableEntries : [])
    .map((entry) => mangaIdentityKey(entry.manga))
    .filter(Boolean));
  const incomingWorkSources = new Map();
  const incomingTitleSources = new Map();
  (matchByWork ? importableEntries : []).forEach(({ manga }) => {
    const workKey = mangaWorkKey(manga);
    if (workKey) {
      const sourceIds = incomingWorkSources.get(workKey) || new Set();
      sourceIds.add(manga.sourceId);
      incomingWorkSources.set(workKey, sourceIds);
    }
    const titleKey = mangaTitleKey(manga);
    if (titleKey) {
      const sourceIds = incomingTitleSources.get(titleKey) || new Set();
      sourceIds.add(manga.sourceId);
      incomingTitleSources.set(titleKey, sourceIds);
    }
  });
  const favorites = [];
  const byManga = new Map();
  (Array.isArray(storedFavorites) ? storedFavorites : []).forEach((manga) => {
    const identityKey = mangaIdentityKey(manga);
    const duplicateIndex = identityKey && incomingIdentityKeys.has(identityKey) ? byManga.get(`identity|${identityKey}`) : undefined;
    if (duplicateIndex !== undefined) {
      favorites[duplicateIndex] = mergeDuplicateFavorite(favorites[duplicateIndex], manga);
      return;
    }
    const index = favorites.push(manga) - 1;
    if (identityKey && incomingIdentityKeys.has(identityKey)) byManga.set(`identity|${identityKey}`, index);
  });
  const removedFavorites = new Set();
  const workCandidates = new Map();
  favorites.forEach((manga, index) => {
    const workKey = mangaWorkKey(manga);
    if (!incomingWorkSources.has(workKey)) return;
    const matches = workCandidates.get(workKey) || [];
    matches.push(index);
    workCandidates.set(workKey, matches);
  });
  workCandidates.forEach((indices, workKey) => {
    if (indices.length === 1) return;
    const incomingSources = incomingWorkSources.get(workKey);
    const nonIncoming = indices.filter((index) => !incomingSources.has(favorites[index].sourceId));
    if (nonIncoming.length !== 1) return;
    const keptIndex = nonIncoming[0];
    indices.filter((index) => index !== keptIndex).forEach((index) => {
      favorites[keptIndex] = mergeDuplicateFavorite(favorites[keptIndex], favorites[index]);
      removedFavorites.add(index);
    });
  });
  const titleCandidates = new Map();
  favorites.forEach((manga, index) => {
    if (removedFavorites.has(index)) return;
    const titleKey = mangaTitleKey(manga);
    if (!incomingTitleSources.has(titleKey)) return;
    const matches = titleCandidates.get(titleKey) || [];
    matches.push(index);
    titleCandidates.set(titleKey, matches);
  });
  titleCandidates.forEach((indices, titleKey) => {
    if (indices.length < 2) return;
    const incomingSources = incomingTitleSources.get(titleKey);
    const nonIncoming = indices.filter((index) => !incomingSources.has(favorites[index].sourceId));
    if (nonIncoming.length !== 1) return;
    const keptIndex = nonIncoming[0];
    indices.filter((index) => index !== keptIndex).forEach((index) => {
      favorites[keptIndex] = mergeDuplicateFavorite(favorites[keptIndex], favorites[index]);
      removedFavorites.add(index);
    });
  });
  if (removedFavorites.size) {
    const keptFavorites = favorites.filter((_, index) => !removedFavorites.has(index));
    favorites.splice(0, favorites.length, ...keptFavorites);
  }
  byManga.clear();
  const workIndices = new Map();
  const titleIndices = new Map();
  favorites.forEach((manga, index) => {
    const sourceId = manga.sourceId || 'leercapitulo';
    byManga.set(`${sourceId}|${urlKey(manga.url)}`, index);
    byManga.set(`${sourceId}|${pathKey(manga.url)}`, index);
    if (String(manga.sourceId || '').startsWith('mihon-')) byManga.set(`${manga.sourceId}|${pathKey(manga.url)}`, index);
    const identityKey = mangaIdentityKey(manga);
    if (identityKey && incomingIdentityKeys.has(identityKey)) byManga.set(`identity|${identityKey}`, index);
    const workKey = mangaWorkKey(manga);
    if (incomingWorkSources.has(workKey)) {
      const indices = workIndices.get(workKey) || [];
      indices.push(index);
      workIndices.set(workKey, indices);
    }
    const titleKey = mangaTitleKey(manga);
    if (incomingTitleSources.has(titleKey)) {
      const indices = titleIndices.get(titleKey) || [];
      indices.push(index);
      titleIndices.set(titleKey, indices);
    }
  });
  workIndices.forEach((indices, workKey) => {
    if (indices.length === 1) byManga.set(`work|${workKey}`, indices[0]);
  });
  titleIndices.forEach((indices, titleKey) => {
    if (indices.length === 1) byManga.set(`title|${titleKey}`, indices[0]);
  });
  const previousMihonCategoryIds = new Set(candidate.categoryNames.map((name) => categoryIds.get(normalizeName(name))).filter(Boolean));
  const defaultCategoryId = categories.find((category) => normalizeName(category.name) === 'todos')?.id;
  let added = 0;
  let updated = 0;
  for (const entry of importableEntries) {
    const manga = entry.manga;
    manga.cats = [...new Set(manga.cats.map((name) => categoryIds.get(normalizeName(name))).filter(Boolean))];
    if (!manga.cats.length && categories[0]?.id) manga.cats = [categories[0].id];
    const key = `${manga.sourceId}|${urlKey(manga.url)}`;
    const legacyKey = entry.legacySourceId && entry.legacyUrl ? `${entry.legacySourceId}|${pathKey(entry.legacyUrl)}` : '';
    const originalKey = entry.originalUrl ? `${manga.sourceId}|${urlKey(entry.originalUrl)}` : '';
    const pathMatchKey = `${manga.sourceId}|${pathKey(manga.url)}`;
    const identityKey = matchByWork ? mangaIdentityKey(manga) : '';
    const workKey = matchByWork ? mangaWorkKey(manga) : '';
    const titleKey = matchByWork ? mangaTitleKey(manga) : '';
    const index = byManga.get(key)
      ?? (originalKey ? byManga.get(originalKey) : undefined)
      ?? byManga.get(pathMatchKey)
      ?? (legacyKey ? byManga.get(legacyKey) : undefined)
      ?? (identityKey ? byManga.get(`identity|${identityKey}`) : undefined)
      ?? (workKey ? byManga.get(`work|${workKey}`) : undefined)
      ?? (titleKey ? byManga.get(`title|${titleKey}`) : undefined);
    const matchedByWork = index !== undefined
      && (byManga.get(`work|${workKey}`) === index || byManga.get(`title|${titleKey}`) === index)
      && byManga.get(key) !== index
      && (!originalKey || byManga.get(originalKey) !== index)
      && byManga.get(pathMatchKey) !== index
      && byManga.get(legacyKey) !== index
      && (!identityKey || byManga.get(`identity|${identityKey}`) !== index);
    if (index === undefined) {
      byManga.set(key, favorites.length);
      byManga.set(pathMatchKey, favorites.length);
      if (identityKey) byManga.set(`identity|${identityKey}`, favorites.length);
      if (workKey) byManga.set(`work|${workKey}`, favorites.length);
      if (titleKey) byManga.set(`title|${titleKey}`, favorites.length);
      if (originalKey) byManga.set(originalKey, favorites.length);
      if (legacyKey) byManga.set(legacyKey, favorites.length);
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
        sourceId: matchedByWork ? existing.sourceId : manga.sourceId,
        sourceName: matchedByWork || !isPlaceholderSourceName(existing.sourceName) ? existing.sourceName : manga.sourceName,
        sourceIcon: existing.sourceIcon || manga.sourceIcon,
        url: matchedByWork ? existing.url : manga.url,
        title: existing.title || manga.title,
        author: existing.author || manga.author,
        description: existing.description || manga.description,
        genres: existing.genres?.length ? existing.genres : manga.genres,
        cover: matchedByWork ? existing.cover || manga.cover : manga.cover || existing.cover,
        chapterTotal: Math.max(Number(existing.chapterTotal) || 0, Number(manga.chapterTotal) || 0),
        chapterReadCount: Math.max(Number(existing.chapterReadCount) || 0, Number(manga.chapterReadCount) || 0),
        coverLocal: matchedByWork ? existing.coverLocal || '' : manga.cover ? '' : existing.coverLocal || '',
        coverCached: matchedByWork ? existing.coverCached || '' : manga.cover ? '' : existing.coverCached || '',
        cats: [...new Set([...keptCategories, ...manga.cats])]
      };
      byManga.set(key, index);
      byManga.set(pathMatchKey, index);
      if (identityKey) byManga.set(`identity|${identityKey}`, index);
      if (workKey) byManga.set(`work|${workKey}`, index);
      if (titleKey && incomingTitleSources.has(titleKey)) byManga.set(`title|${titleKey}`, index);
      if (originalKey) byManga.set(originalKey, index);
      if (legacyKey) byManga.set(legacyKey, index);
      updated += 1;
    }
    const favorite = favorites[index === undefined ? favorites.length - 1 : index];
    const importedProgress = entry.chapterProgress || [];
    if (importedProgress.length) {
      favorite.mihonProgress = mergeChapterProgress(favorite.mihonProgress, importedProgress);
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
  } catch (error) {
    for (const [key, value] of Object.entries(previous)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    throw error;
  }
  return { added, updated };
}
