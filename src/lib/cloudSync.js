import { createClient } from '@supabase/supabase-js';
import { libraryKey, lib } from './library.js';
import { progress } from './progress.js';
import { extensions, isExtensionAllowed, EXTENSION_INSTALLED_EVENT, isAdultExtension } from './extensions.js';
import { settings } from './settings.js';
import {
  CLOUD_SYNC_DETAILS_BACKFILL_EVENT,
  CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY,
  CLOUD_SYNC_LOCAL_CHANGE_EVENT,
  pendingLibraryDetailKey,
  readPendingLibraryDetails
} from './cloudSyncEvents.js';
import { preloadLibraryCoversBatch } from './covers.js';

const TABLE = 'cytlex_sync_state';
const ACCOUNT_KEY = 'cytlex:cloud-sync-account:v1';
const BACKUP_PENDING_KEY = 'cytlex:cloud-sync-backup-pending:v1';
const TOMBSTONES_KEY = 'cytlex:cloud-sync-tombstones:v1';
const DEFAULT_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';
const SYNCED_SETTINGS = ['theme', 'mode', 'language', 'readerMode', 'readerZoom', 'readerDoublePage', 'libraryView', 'coverSize', 'libraryShowUnread', 'hideSavedManga', 'chaptersPerRow', 'sidebarCollapsed', 'extIndexUrl', 'anilistSynopsisLang', 'anilistCover', 'performanceMode'];
const SETTINGS_LABELS = { theme: 'Tema', mode: 'Modo', language: 'Idioma', readerMode: 'Modo de lectura', readerZoom: 'Zoom del lector', readerDoublePage: 'Página doble', libraryView: 'Vista de biblioteca', coverSize: 'Tamaño de portadas', libraryShowUnread: 'Mostrar capítulos sin leer', hideSavedManga: 'Ocultar mangas guardados', chaptersPerRow: 'Capítulos por fila', sidebarCollapsed: 'Barra lateral', extIndexUrl: 'Repositorio de extensiones', anilistSynopsisLang: 'Idioma de sinopsis', anilistCover: 'Portada de AniList', performanceMode: 'Modo rendimiento' };
const FAVORITE_METADATA_FIELDS = [
  'title', 'author', 'artist', 'cover', 'description', 'sinopsis', 'facts', 'type', 'genres', 'chapterTotal', 'sourceName', 'sourceIcon',
  'updatedAt', 'catsUpdatedAt', 'savedAt', 'coverCached', 'coverLocal', 'coverRefreshPending'
];
const syncedSettings = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(SYNCED_SETTINGS.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]))
  : null;
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const client = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const listeners = new Set();

let state = {
  configured: Boolean(client),
  status: client ? 'signed-out' : 'unconfigured',
  email: '',
  error: '',
  revision: 0,
  pendingChoice: null,
  localChanges: [],
  ageConfirmation: null,
  warning: '',
  restoreProgress: null
};
let started = false;
let stopAuth = null;
let activeUserId = '';
let initializingUserId = '';
let revision = 0;
let initialized = false;
let applying = false;
let localChangesPending = false;
let localChangeRevision = 0;
let lastLocalSnapshot = '';
let backupImportPending = false;
let syncPromise = null;
let localChangeSyncTimer = null;
let syncAbortController = null;
let ageConfirmationResolver = null;
let localChangeSyncDelay = 0;

const AGE_CONFIRMATION_CANCELLED = 'CLOUD_SYNC_AGE_CONFIRMATION_CANCELLED';

const emit = () => listeners.forEach((listener) => listener());
const updateState = (patch) => {
  state = { ...state, ...patch };
  emit();
};

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function tombstonesStorageKey() {
  return `${TOMBSTONES_KEY}:${activeUserId || 'guest'}`;
}

function localSnapshot() {
  const installed = readJson('cytlex:extensions:v1', []);
  const favorites = lib.favs().map(({ coverCached, coverLocal, ...manga }) => ({
    ...manga,
    ...(manga.cover && !/^https?:\/\//i.test(manga.cover) ? { cover: '' } : {})
  }));
  return {
    schemaVersion: 1,
    favorites,
    categories: lib.cats(),
    progress: readJson('cytlex:progress:v1', {}),
    settings: syncedSettings(settings.get()),
    extensions: (Array.isArray(installed) ? installed : []).map((record) => ({
      id: record?.manifest?.id,
      version: record?.installedVersion || record?.manifest?.version || '0',
      installedAt: record?.installedAt || 0
    })).filter((record) => record.id),
    tombstones: readJson(tombstonesStorageKey(), { favorites: {}, categories: {}, progress: {}, extensions: {} })
  };
}

function normalizeSnapshot(value) {
  const snapshot = value && typeof value === 'object' ? value : {};
  return {
    schemaVersion: 1,
    favorites: Array.isArray(snapshot.favorites) ? snapshot.favorites : [],
    categories: Array.isArray(snapshot.categories) ? snapshot.categories : [{ id: 'todos', name: 'Todos' }],
    progress: snapshot.progress && typeof snapshot.progress === 'object' ? snapshot.progress : {},
    settings: syncedSettings(snapshot.settings),
    extensions: Array.isArray(snapshot.extensions) ? snapshot.extensions.filter((item) => item?.id) : [],
    tombstones: snapshot.tombstones && typeof snapshot.tombstones === 'object'
      ? {
        favorites: snapshot.tombstones.favorites || {},
        categories: snapshot.tombstones.categories || {},
        progress: snapshot.tombstones.progress || {},
        extensions: snapshot.tombstones.extensions || {}
      }
      : { favorites: {}, categories: {}, progress: {}, extensions: {} }
  };
}

function stableJson(value) {
  const sortKeys = (item) => {
    if (Array.isArray(item)) return item.map(sortKeys);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sortKeys(item[key])]));
  };
  return JSON.stringify(sortKeys(value));
}

const meaningfulProgressEntry = (entry) => {
  if (entry == null) return null;
  if (typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const value = Object.fromEntries(Object.entries(entry).filter(([field]) => !['updatedAt', 'readAt'].includes(field)));
  return Object.keys(value).length ? value : null;
};

const serializeSnapshot = (value) => stableJson(normalizeSnapshot(value));

function serializeMeaningfulSnapshot(value) {
  const snapshot = normalizeSnapshot(value);
  const without = (item, fields) => item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).filter(([field]) => !fields.includes(field)))
    : item;
  return stableJson({
    ...snapshot,
    favorites: snapshot.favorites.map((item) => without(item, FAVORITE_METADATA_FIELDS)),
    categories: snapshot.categories.map((item) => without(item, ['updatedAt'])),
    progress: Object.fromEntries(Object.entries(snapshot.progress).flatMap(([key, item]) => {
      const value = meaningfulProgressEntry(item);
      return value === null ? [] : [[key, value]];
    })),
    extensions: snapshot.extensions.map((item) => without(item, ['installedAt']))
  });
}

const mangaKey = (manga) => libraryKey(manga.url, manga.sourceId || 'leercapitulo');

function summarizeSnapshotChanges(beforeValue, afterValue, { compareAccount = false } = {}) {
  const before = normalizeSnapshot(beforeValue);
  const after = normalizeSnapshot(afterValue);
  const groups = [];
  const wasDeletedAfterSnapshot = (snapshot, kind, key, item, timestampFor) =>
    Number(snapshot.tombstones[kind]?.[key]) > (Number(timestampFor(item)) || 0);
  const oneSidedAction = (kind, key, item, side, timestampFor) => {
    if (!compareAccount) return side === 'before' ? 'Eliminado' : 'Agregado';
    if (side === 'before') return wasDeletedAfterSnapshot(after, kind, key, item, timestampFor) ? 'Eliminado' : 'Agregado';
    return wasDeletedAfterSnapshot(before, kind, key, item, timestampFor) ? 'Eliminado' : 'Agregado';
  };
  const compareRows = (label, previousRows, currentRows, keyFor, nameFor, ignoredFields = [], kind, timestampFor = () => 0) => {
    const previous = new Map(previousRows.map((item) => [keyFor(item), item]));
    const current = new Map(currentRows.map((item) => [keyFor(item), item]));
    const changes = [];
    previous.forEach((item, key) => {
      const next = current.get(key);
      if (!next) changes.push({ action: oneSidedAction(kind, key, item, 'before', timestampFor), name: nameFor(item) });
      else {
        const stripMetadata = (value) => Object.fromEntries(Object.entries(value).filter(([field]) => !ignoredFields.includes(field)));
        if (stableJson(stripMetadata(item)) !== stableJson(stripMetadata(next))) {
          const fields = [...new Set([...Object.keys(item), ...Object.keys(next)])]
            .filter((field) => !ignoredFields.includes(field) && stableJson(item[field]) !== stableJson(next[field]));
          changes.push({ action: 'Modificado', name: nameFor(next), fields });
        }
      }
    });
    current.forEach((item, key) => {
      if (!previous.has(key)) changes.push({ action: oneSidedAction(kind, key, item, 'after', timestampFor), name: nameFor(item) });
    });
    if (changes.length) groups.push({ label, count: changes.length, items: changes.slice(0, 6), more: Math.max(0, changes.length - 6) });
  };

  compareRows('Biblioteca', before.favorites, after.favorites, mangaKey, (manga) => manga.title || manga.url,
    FAVORITE_METADATA_FIELDS, 'favorites', (manga) => manga.savedAt || 0);
  compareRows('Categorías', before.categories, after.categories, (category) => category.id, (category) => category.name || category.id, ['updatedAt'], 'categories', (category) => category.updatedAt || 0);
  compareRows('Extensiones', before.extensions, after.extensions, (extension) => extension.id, (extension) => extensions.manifest(extension.id).name || extension.id, ['installedAt'], 'extensions', (extension) => extension.installedAt || 0);

  if (before.settings && after.settings) {
    const changed = SYNCED_SETTINGS.filter((key) => stableJson(before.settings[key]) !== stableJson(after.settings[key]));
    if (changed.length) groups.push({ label: 'Ajustes', count: changed.length, items: changed.slice(0, 6).map((key) => ({ action: 'Modificado', name: SETTINGS_LABELS[key] || key })), more: Math.max(0, changed.length - 6) });
  } else if (compareAccount && !before.settings && after.settings) {
    groups.push({ label: 'Ajustes', count: 0, items: [], more: 0, message: 'La cuenta aún no tiene ajustes guardados. Al cargar sus datos, se conservarán los ajustes de este dispositivo.' });
  } else if (compareAccount && before.settings && !after.settings) {
    groups.push({ label: 'Ajustes', count: 0, items: [], more: 0, message: 'Este dispositivo aún no tiene ajustes disponibles para comparar.' });
  }

  const progressKeys = new Set([...Object.keys(before.progress), ...Object.keys(after.progress)]);
  const progressChanges = { Agregado: 0, Modificado: 0, Eliminado: 0 };
  progressKeys.forEach((key) => {
    const previous = meaningfulProgressEntry(before.progress[key]);
    const current = meaningfulProgressEntry(after.progress[key]);
    if (stableJson(previous) === stableJson(current)) return;
    if (previous === null) progressChanges[oneSidedAction('progress', key, after.progress[key], 'after', (entry) => entry?.updatedAt || entry?.readAt || 0)] += 1;
    else if (current === null) progressChanges[oneSidedAction('progress', key, before.progress[key], 'before', (entry) => entry?.updatedAt || entry?.readAt || 0)] += 1;
    else progressChanges.Modificado += 1;
  });
  const progressItems = Object.entries(progressChanges)
    .filter(([, count]) => count > 0)
    .map(([action, count]) => ({ action, count }));
  if (progressItems.length) {
    groups.push({
      label: 'Progreso de lectura',
      count: progressItems.reduce((total, item) => total + item.count, 0),
      items: progressItems,
      more: 0
    });
  }
  return groups;
}

function mergeSnapshots(localValue, cloudValue) {
  const local = normalizeSnapshot(localValue);
  const cloud = normalizeSnapshot(cloudValue);
  const tombstones = { favorites: {}, categories: {}, progress: {}, extensions: {} };
  Object.keys(tombstones).forEach((kind) => {
    const keys = new Set([...Object.keys(local.tombstones[kind]), ...Object.keys(cloud.tombstones[kind])]);
    keys.forEach((key) => {
      tombstones[kind][key] = Math.max(Number(local.tombstones[kind][key]) || 0, Number(cloud.tombstones[kind][key]) || 0);
    });
  });
  const favorites = new Map(cloud.favorites.map((manga) => [mangaKey(manga), manga]));
  local.favorites.forEach((manga) => {
    const key = mangaKey(manga);
    const current = favorites.get(key);
    if (!current) favorites.set(key, manga);
    else {
      const favorite = Number(manga.updatedAt || manga.savedAt) >= Number(current.updatedAt || current.savedAt) ? manga : current;
      const localCatsUpdatedAt = Number(manga.catsUpdatedAt) || 0;
      const cloudCatsUpdatedAt = Number(current.catsUpdatedAt) || 0;
      const categories = localCatsUpdatedAt === cloudCatsUpdatedAt
        ? [...new Set([...(current.cats || []), ...(manga.cats || [])])]
        : [...((localCatsUpdatedAt > cloudCatsUpdatedAt ? manga.cats : current.cats) || [])];
      favorites.set(key, {
        ...favorite,
        cats: categories,
        ...(Math.max(localCatsUpdatedAt, cloudCatsUpdatedAt) ? { catsUpdatedAt: Math.max(localCatsUpdatedAt, cloudCatsUpdatedAt) } : {})
      });
    }
  });
  const categories = new Map(cloud.categories.map((category) => [category.id, category]));
  local.categories.forEach((category) => {
    const current = categories.get(category.id);
    if (!current || Number(category.updatedAt || 0) >= Number(current.updatedAt || 0)) categories.set(category.id, category);
  });
  const mergedProgress = { ...cloud.progress };
  Object.entries(local.progress).forEach(([key, entry]) => {
    if (!mergedProgress[key] || Number(entry?.updatedAt || entry?.readAt) >= Number(mergedProgress[key]?.updatedAt || mergedProgress[key]?.readAt)) {
      mergedProgress[key] = entry;
    }
  });
  const installed = new Map(cloud.extensions.map((item) => [item.id, item]));
  local.extensions.forEach((item) => {
    const current = installed.get(item.id);
    if (!current || Number(item.installedAt) >= Number(current.installedAt)) installed.set(item.id, item);
  });
  const clearTombstoneForNewer = (rows, keyFor, kind, timestampFor) => rows.forEach((item) => {
    const key = keyFor(item);
    if (Number(timestampFor(item)) > (Number(tombstones[kind][key]) || 0)) delete tombstones[kind][key];
  });
  clearTombstoneForNewer(favorites.values(), mangaKey, 'favorites', (item) => item.savedAt || 0);
  clearTombstoneForNewer(categories.values(), (item) => item.id, 'categories', (item) => item.updatedAt || 0);
  clearTombstoneForNewer(Object.entries(mergedProgress).map(([key, item]) => ({ key, item })), (row) => row.key, 'progress', (row) => row.item?.updatedAt || row.item?.readAt || 0);
  clearTombstoneForNewer(installed.values(), (item) => item.id, 'extensions', (item) => item.installedAt || 0);
  const categoryRows = [...categories.entries()].filter(([id, category]) => id === 'todos' || Number(category.updatedAt || 0) > (Number(tombstones.categories[id]) || 0));
  const validCategoryIds = new Set(categoryRows.map(([id]) => id));
  const fallbackCategoryId = validCategoryIds.has('todos') ? 'todos' : categoryRows[0]?.[0];
  const favoriteRows = [...favorites.entries()]
    .filter(([key, manga]) => Number(manga.savedAt || 0) > (Number(tombstones.favorites[key]) || 0))
    .map(([key, manga]) => {
      const cats = [...new Set((Array.isArray(manga.cats) ? manga.cats : []).filter((id) => validCategoryIds.has(id)))];
      return [key, { ...manga, cats: cats.length ? cats : fallbackCategoryId ? [fallbackCategoryId] : [] }];
    });
  const progressRows = Object.entries(mergedProgress).filter(([key, entry]) => Number(entry?.updatedAt || entry?.readAt || 0) > (Number(tombstones.progress[key]) || 0));
  const extensionRows = [...installed.entries()].filter(([id, item]) => Number(item.installedAt || 0) > (Number(tombstones.extensions[id]) || 0));
  return {
    schemaVersion: 1,
    favorites: favoriteRows.map(([, manga]) => manga),
    categories: categoryRows.map(([, category]) => category),
    progress: Object.fromEntries(progressRows),
    settings: cloud.settings || local.settings,
    extensions: extensionRows.map(([, extension]) => extension),
    tombstones
  };
}

function trackLocalDeletions(snapshot) {
  if (!lastLocalSnapshot) return snapshot;
  let previous;
  try { previous = normalizeSnapshot(JSON.parse(lastLocalSnapshot)); } catch { return snapshot; }
  const tombstones = normalizeSnapshot(snapshot).tombstones;
  const now = Date.now();
  const markRemoved = (before, after, keyFor, kind) => {
    const present = new Set(after.map(keyFor));
    before.forEach((item) => {
      const key = keyFor(item);
      if (!present.has(key)) tombstones[kind][key] = Math.max(Number(tombstones[kind][key]) || 0, now);
    });
  };
  markRemoved(previous.favorites, snapshot.favorites, mangaKey, 'favorites');
  markRemoved(previous.categories, snapshot.categories, (category) => category.id, 'categories');
  markRemoved(previous.extensions, snapshot.extensions, (extension) => extension.id, 'extensions');
  const progressKeys = new Set(Object.keys(snapshot.progress));
  Object.keys(previous.progress).forEach((key) => {
    if (!progressKeys.has(key)) tombstones.progress[key] = Math.max(Number(tombstones.progress[key]) || 0, now);
  });
  const clearReadded = (rows, keyFor, kind, timestampFor) => rows.forEach((item) => {
    const key = keyFor(item);
    if (Number(timestampFor(item)) > (Number(tombstones[kind][key]) || 0)) delete tombstones[kind][key];
  });
  clearReadded(snapshot.favorites, mangaKey, 'favorites', (item) => item.savedAt || 0);
  clearReadded(snapshot.categories, (item) => item.id, 'categories', (item) => item.updatedAt || 0);
  clearReadded(snapshot.extensions, (item) => item.id, 'extensions', (item) => item.installedAt || 0);
  Object.entries(snapshot.progress).forEach(([key, item]) => {
    if (Number(item?.updatedAt || item?.readAt || 0) > (Number(tombstones.progress[key]) || 0)) delete tombstones.progress[key];
  });
  localStorage.setItem(tombstonesStorageKey(), JSON.stringify(tombstones));
  return { ...snapshot, tombstones };
}

function scheduleLocalResync(delay = 800) {
  if (localChangeSyncTimer && delay >= localChangeSyncDelay) return;
  if (localChangeSyncTimer) window.clearTimeout(localChangeSyncTimer);
  localChangeSyncDelay = delay;
  localChangeSyncTimer = window.setTimeout(async () => {
    localChangeSyncTimer = null;
    localChangeSyncDelay = 0;
    if (syncPromise) {
      try { await syncPromise; } catch {}
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
    if (activeUserId && initialized && !state.pendingChoice && ['local-pending', 'syncing'].includes(state.status) && localChangesPending) {
      void cloudSync.syncNow().catch(() => {});
    }
  }, delay);
}

const hasLocalData = (snapshot) => snapshot.favorites.length > 0
  || Object.keys(snapshot.progress).length > 0
  || snapshot.extensions.length > 0
  || snapshot.categories.some((category) => category.id !== 'todos');

async function fetchRemote(userId, signal) {
  const timeoutSignal = AbortSignal.timeout(30000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const { data, error } = await client.from(TABLE)
    .select('payload, revision')
    .eq('user_id', userId)
    .abortSignal(requestSignal)
    .maybeSingle();
  if (error) throw error;
  return data ? { payload: normalizeSnapshot(data.payload), revision: data.revision } : null;
}

async function fetchRemoteRevision(userId) {
  const { data, error } = await client.from(TABLE)
    .select('revision')
    .eq('user_id', userId)
    .abortSignal(AbortSignal.timeout(30000))
    .maybeSingle();
  if (error) throw error;
  return data?.revision || 0;
}

async function reconcileExtensions(snapshot) {
  const desired = normalizeSnapshot(snapshot).extensions;
  const targetIds = new Set(desired.map((item) => item.id));
  const current = extensions.syncRecords();
  if (!desired.length) {
    return { records: [], previous: current, warning: '', installedIds: [] };
  }

  const repoUrl = settings.get().extIndexUrl?.trim() || DEFAULT_REPOSITORY;
  let repository;
  try {
    repository = await extensions.repoIndex(repoUrl);
  } catch (error) {
    return { records: current, previous: current, installedIds: [], warning: `No se pudo consultar el repositorio de extensiones: ${error.message}` };
  }

  const blocked = [];
  const missing = [];
  const manifests = new Map();
  desired.forEach((item) => {
    const manifest = repository.find((entry) => entry.id === item.id);
    if (!manifest || String(manifest.version || '0') !== String(item.version || '0')) {
      missing.push(item.id);
      return;
    }
    if (!isExtensionAllowed(manifest, settings.get().showAdultExtensions)) {
      blocked.push(item.id);
      return;
    }
    manifests.set(item.id, manifest);
  });

  const records = current.filter(({ manifest }) => targetIds.has(manifest.id));
  const installedIds = [];
  for (const [id, manifest] of manifests) {
    const installed = records.find((record) => record.manifest.id === id);
    if (installed && String(installed.installedVersion || installed.manifest.version || '0') === String(manifest.version || '0')) continue;
    try {
      const prepared = await extensions.prepareSyncRecord(manifest, repoUrl);
      const index = records.findIndex((record) => record.manifest.id === id);
      if (index >= 0) records[index] = prepared;
      else records.push(prepared);
      installedIds.push(id, ...(manifest.config?.sources || []).map((source) => source.id));
    } catch {
      missing.push(id);
    }
  }

  const warning = [
    blocked.length ? `No se restauraron extensiones bloqueadas por los ajustes de contenido: ${blocked.join(', ')}.` : '',
    missing.length ? `No se encontraron versiones disponibles para: ${[...new Set(missing)].join(', ')}.` : ''
  ].filter(Boolean).join(' ');
  return { records, previous: current, warning, installedIds };
}

async function confirmAdultSyncIfNeeded(snapshot) {
  if (settings.get().showAdultExtensions) return true;
  const desired = normalizeSnapshot(snapshot).extensions;
  if (!desired.length) return true;

  const repoUrl = settings.get().extIndexUrl?.trim() || DEFAULT_REPOSITORY;
  let repository = [];
  try { repository = await extensions.repoIndex(repoUrl); } catch {}
  const manifests = new Map(repository.map((manifest) => [manifest.id, manifest]));
  const adultExtensions = desired.map(({ id }) => manifests.get(id) || extensions.manifest(id))
    .filter(isAdultExtension)
    .map((manifest) => ({
      id: manifest.id,
      name: manifest.name || manifest.id,
      rating: String(manifest.contentWarning || '').toUpperCase().replace(/\s*\+?\s*18$/, '')
    }));
  if (!adultExtensions.length) return true;

  updateState({
    status: 'age-confirmation',
    ageConfirmation: { extensions: adultExtensions },
    restoreProgress: null
  });
  const confirmed = await new Promise((resolve) => { ageConfirmationResolver = resolve; });
  if (!confirmed) {
    const error = new Error('La sincronización se canceló porque no se confirmó la edad.');
    error.code = AGE_CONFIRMATION_CANCELLED;
    throw error;
  }
  return true;
}

async function applySnapshot(value, { syncExtensions = true, expectedRevision = localChangeRevision, expectedUser = activeUserId } = {}) {
  const snapshot = normalizeSnapshot(value);
  if (progress.hasPendingWrites()) throw new Error('Guarda primero el progreso pendiente en este dispositivo.');
  const previousLocal = localSnapshot();
  const before = serializeSnapshot(previousLocal);
  const existingFavoriteKeys = new Set(previousLocal.favorites.filter((manga) => manga?.url).map(pendingLibraryDetailKey));
  const previousDetailJob = readPendingLibraryDetails();
  const previousPendingDetails = new Set(previousDetailJob?.pending || []);
  const retryAllPendingDetails = Boolean(previousDetailJob && !Array.isArray(previousDetailJob.pending));
  const favoritesToRestore = snapshot.favorites.filter((manga) =>
    manga?.url && (
      !existingFavoriteKeys.has(pendingLibraryDetailKey(manga))
      || manga.coverRefreshPending
      || retryAllPendingDetails
      || previousPendingDetails.has(pendingLibraryDetailKey(manga))
    ));
  if (syncExtensions) await confirmAdultSyncIfNeeded(snapshot);
  updateState({ restoreProgress: favoritesToRestore.length ? { label: 'Preparando la restauración' } : null });
  const prepared = syncExtensions ? await reconcileExtensions(snapshot) : null;
  if (activeUserId !== expectedUser || localChangeRevision !== expectedRevision || progress.hasPendingWrites()
    || serializeSnapshot(localSnapshot()) !== before) {
    throw new Error('Los datos cambiaron. Sincroniza de nuevo para revisarlos.');
  }
  const restorationId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const writes = [
    ['cytlex:cats:v1', JSON.stringify(snapshot.categories)],
    ['cytlex:favs', JSON.stringify(snapshot.favorites)],
    ['cytlex:progress:v1', JSON.stringify(snapshot.progress)],
    ...(snapshot.settings ? [['cytlex:settings:v1', JSON.stringify({ ...settings.get(), ...snapshot.settings })]] : []),
    [tombstonesStorageKey(), JSON.stringify(snapshot.tombstones)],
    [ACCOUNT_KEY, expectedUser],
    [CLOUD_SYNC_DETAILS_BACKFILL_PENDING_KEY, favoritesToRestore.length
      ? JSON.stringify({ id: restorationId, pending: [...new Set(favoritesToRestore.filter((manga) => manga?.url).map(pendingLibraryDetailKey))] })
      : null],
    ...(prepared ? [['cytlex:extensions:v1', JSON.stringify(prepared.records)]] : [])
  ];
  const previous = writes.map(([key]) => [key, localStorage.getItem(key)]);
  applying = true;
  try {
    let written = 0;
    try {
      for (const [key, data] of writes) { if (data === null) localStorage.removeItem(key); else localStorage.setItem(key, data); written += 1; }
    } catch (error) {
      let rollbackFailed = false;
      for (let index = written - 1; index >= 0; index -= 1) {
        const [key, oldValue] = previous[index];
        try { if (oldValue === null) localStorage.removeItem(key); else localStorage.setItem(key, oldValue); }
        catch { rollbackFailed = true; }
      }
      throw new Error(rollbackFailed
        ? 'No se pudieron aplicar ni restaurar todos los datos locales. Revisa el espacio disponible y carga la cuenta de nuevo.'
        : 'No se pudieron guardar los datos de la cuenta en este dispositivo. Revisa el espacio disponible.');
    }
    if (prepared) extensions.applySyncRecords(prepared.records, prepared.previous);
    if (snapshot.settings) settings.reload();
    progress.reload();
    window.dispatchEvent(new Event('cytlex:library-updated'));
    window.dispatchEvent(new Event('cytlex:source-config-changed'));
    lastLocalSnapshot = JSON.stringify(localSnapshot());
    updateState({ localChanges: [] });
    void prepareSyncedLibrary(favoritesToRestore, restorationId);
    if (prepared?.installedIds.length) window.dispatchEvent(new CustomEvent(EXTENSION_INSTALLED_EVENT, { detail: { sourceIds: prepared.installedIds } }));
    return prepared?.warning || '';
  } finally {
    applying = false;
  }
}

async function preloadAccountLibraryCovers(favorites, onProgress) {
  const covers = [...new Set((favorites || [])
    .map((manga) => manga?.cover)
    .filter((cover) => typeof cover === 'string' && /^https?:\/\//i.test(cover)))];
  if (covers.length) await preloadLibraryCoversBatch(covers, {
    web: true,
    persist: true,
    onProgress: ({ current }) => onProgress?.({ label: 'Preparando las portadas', current, total: covers.length })
  });
}

async function prepareSyncedLibrary(favorites, restorationId) {
  const coverCount = new Set((favorites || [])
    .map((manga) => manga?.cover)
    .filter((cover) => typeof cover === 'string' && /^https?:\/\//i.test(cover))).size;
  if (coverCount) updateState({ restoreProgress: { label: 'Preparando las portadas', current: 0, total: coverCount } });
  try {
    await preloadAccountLibraryCovers(favorites, (restoreProgress) => {
      if (readPendingLibraryDetails()?.id === restorationId) updateState({ restoreProgress });
    });
  } catch {}
  if (favorites.length) {
    if (readPendingLibraryDetails()?.id !== restorationId) return;
    window.dispatchEvent(new Event(CLOUD_SYNC_DETAILS_BACKFILL_EVENT));
    if (state.restoreProgress?.label !== 'Recuperando detalles de las fuentes') updateState({ restoreProgress: null });
  } else {
    updateState({ restoreProgress: null });
  }
}

async function writeRemote(payload, expectedRevision) {
  const { data, error } = await client.rpc('save_cytlex_sync_state', {
    p_payload: payload,
    p_expected_revision: expectedRevision
  }).abortSignal(AbortSignal.timeout(30000));
  if (error) throw error;
  if (Number(data) === 0) throw Object.assign(new Error('Sync revision conflict'), { code: '40001' });
  return Number(data);
}

async function persistSnapshot(payload, expectedRevision, retries = 3) {
  try {
    const nextRevision = await writeRemote(payload, expectedRevision);
    revision = nextRevision;
    updateState({ revision, status: 'synced', error: '', warning: '', localChanges: [] });
    lastLocalSnapshot = JSON.stringify(normalizeSnapshot(payload));
    return payload;
  } catch (error) {
    if (error.code !== '40001' || retries <= 0) throw error;
    const remote = await fetchRemote(activeUserId);
    if (!remote) throw error;
    revision = remote.revision;
    const merged = mergeSnapshots(payload, remote.payload);
    if (serializeSnapshot(merged) === serializeSnapshot(remote.payload)) {
      const warning = await applySnapshot(merged);
      lastLocalSnapshot = JSON.stringify(localSnapshot());
      updateState({ revision, status: 'synced', error: '', warning, localChanges: [] });
      return merged;
    }
    const warning = await applySnapshot(merged);
    updateState({ warning });
    return persistSnapshot(merged, remote.revision, retries - 1);
  }
}

async function initializeUser(user) {
  if (user.id === activeUserId && (initialized || initializingUserId === user.id)) return;
  activeUserId = user.id;
  initializingUserId = user.id;
  initialized = false;
  revision = 0;
  updateState({ email: user.email || '', status: 'loading', error: '', warning: '', pendingChoice: null, ageConfirmation: null });
  try {
    const [remote, local] = await Promise.all([fetchRemote(user.id), Promise.resolve(localSnapshot())]);
    if (activeUserId !== user.id) return;
    revision = remote?.revision || 0;
    lastLocalSnapshot = JSON.stringify(local);
    const comparableLocal = remote && !remote.payload.settings ? { ...local, settings: null } : local;
    const different = remote ? serializeMeaningfulSnapshot(comparableLocal) !== serializeMeaningfulSnapshot(remote.payload) : hasLocalData(local);
    initialized = true;
    localChangesPending = different;
    updateState({ status: different ? 'local-pending' : 'connected', revision, localChanges: remote ? summarizeSnapshotChanges(remote.payload, local, { compareAccount: true }) : [] });
  } catch (error) {
    if (error.code === AGE_CONFIRMATION_CANCELLED) {
      initialized = true;
      lastLocalSnapshot = JSON.stringify(localSnapshot());
      localChangesPending = false;
      updateState({ status: 'connected', error: '', warning: '', restoreProgress: null });
      return;
    }
    if (activeUserId === user.id) updateState({ status: 'error', error: error.message, restoreProgress: null });
  } finally {
    if (initializingUserId === user.id) initializingUserId = '';
  }
}

function onLocalChange(event) {
  if (!activeUserId || (!initialized && !state.pendingChoice) || applying) return;
  if (event.detail?.type === 'progress-page') {
    localChangesPending = true;
    localChangeRevision += 1;
    updateState({ status: 'local-pending', pendingChoice: null, localChanges: [] });
    return;
  }
  const pendingChoice = state.pendingChoice;
  let snapshot;
  if (event.detail?.type === 'backup-import') {
    backupImportPending = true;
    localStorage.setItem(BACKUP_PENDING_KEY, '1');
    snapshot = localSnapshot();
  } else {
    snapshot = trackLocalDeletions(localSnapshot());
  }
  let previous = null;
  try { if (lastLocalSnapshot) previous = JSON.parse(lastLocalSnapshot); } catch {}
  const hasChanges = !previous || serializeSnapshot(snapshot) !== serializeSnapshot(previous);
  if (!hasChanges) {
    if (pendingChoice) return;
    localChangesPending = false;
    backupImportPending = false;
    localStorage.removeItem(BACKUP_PENDING_KEY);
    if (localChangeSyncTimer) window.clearTimeout(localChangeSyncTimer);
    localChangeSyncTimer = null;
    localChangeSyncDelay = 0;
    updateState({ status: 'synced', localChanges: [] });
    return;
  }
  localChangesPending = true;
  localChangeRevision += 1;
  if (pendingChoice) {
    updateState({ status: 'local-pending', pendingChoice: null, localChanges: summarizeSnapshotChanges(pendingChoice.remote.payload, snapshot, { compareAccount: true }) });
    return;
  }
  if (previous && serializeMeaningfulSnapshot(snapshot) === serializeMeaningfulSnapshot(previous)) {
    updateState({ status: 'syncing', localChanges: [] });
    scheduleLocalResync();
    return;
  }
  updateState({ status: 'local-pending', localChanges: summarizeSnapshotChanges(previous || {}, snapshot) });
}

function onStorageChange(event) {
  if (event.key === null || ['cytlex:cats:v1', 'cytlex:favs', 'cytlex:extensions:v1', 'cytlex:settings:v1'].includes(event.key)) {
    onLocalChange({ detail: { type: 'storage' } });
  }
}

export const cloudSync = {
  getState() { return state; },
  setRestoreProgress(restoreProgress) { updateState({ restoreProgress: restoreProgress || null }); },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  cancelAccountViewSync() {
    syncAbortController?.abort();
    if (state.pendingChoice) updateState({ status: 'local-pending', pendingChoice: null });
  },
  start() {
    if (!client || started) return () => {};
    started = true;
    window.addEventListener(CLOUD_SYNC_LOCAL_CHANGE_EVENT, onLocalChange);
    window.addEventListener('cytlex:settings', onLocalChange);
    window.addEventListener('storage', onStorageChange);
    const auth = client.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const user = session.user;
        const isNewUser = user.id !== activeUserId;
        if (isNewUser) {
          activeUserId = user.id;
          initialized = false;
          initializingUserId = '';
          updateState({ email: user.email || '', status: 'loading', pendingChoice: null, localChanges: [], error: '' });
        }
        if (!isNewUser && (initialized || initializingUserId === user.id || state.pendingChoice)) return;
        if (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION') return;
        updateState({ email: session.user.email || '', status: 'loading', error: '' });
        window.setTimeout(() => { void initializeUser(user); }, 0);
      } else if (event === 'SIGNED_OUT') {
        if (localChangeSyncTimer) window.clearTimeout(localChangeSyncTimer);
        localChangeSyncTimer = null;
        localChangeSyncDelay = 0;
        syncAbortController?.abort();
        activeUserId = '';
        initializingUserId = '';
        initialized = false;
        revision = 0;
        localChangesPending = false;
        localChangeRevision = 0;
        lastLocalSnapshot = '';
        backupImportPending = false;
        updateState({ email: '', status: 'signed-out', revision: 0, pendingChoice: null, localChanges: [], ageConfirmation: null, error: '', warning: '', restoreProgress: null });
      }
    });
    stopAuth = () => auth.data.subscription.unsubscribe();
    return () => {
      window.removeEventListener(CLOUD_SYNC_LOCAL_CHANGE_EVENT, onLocalChange);
      window.removeEventListener('cytlex:settings', onLocalChange);
      window.removeEventListener('storage', onStorageChange);
      stopAuth?.();
      stopAuth = null;
      started = false;
    };
  },
  async signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },
  async signUp(email, password) {
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    return Boolean(data.session);
  },
  async signOut(options) {
    const { error } = await client.auth.signOut(options);
    if (error) throw error;
  },
  resolveAgeConfirmation(confirmed) {
    const resolve = ageConfirmationResolver;
    const ratings = state.ageConfirmation?.extensions?.map((item) => item.rating) || [];
    ageConfirmationResolver = null;
    updateState({ ageConfirmation: null });
    if (confirmed) {
      const current = settings.get();
      settings.set({
        showAdultExtensions: true,
        adultContentRatings: [...new Set([...current.adultContentRatings, ...ratings])]
      });
    }
    resolve?.(Boolean(confirmed));
  },
  async syncNow() {
    if (!activeUserId || !initialized || state.pendingChoice) return;
    if (syncPromise) return syncPromise;
    const userId = activeUserId;
    const localRevision = localChangeRevision;
    const hasLocalChanges = localChangesPending;
    const controller = new AbortController();
    syncAbortController = controller;
    const local = hasLocalChanges ? trackLocalDeletions(localSnapshot()) : localSnapshot();
    updateState({ status: 'syncing', error: '' });
    const operation = (async () => {
      try {
        const remote = await fetchRemote(userId, controller.signal);
        if (controller.signal.aborted || activeUserId !== userId) return;
        if (localChangeRevision !== localRevision) {
          updateState({ status: 'local-pending', pendingChoice: null });
          return;
        }
        const accountState = remote || { payload: normalizeSnapshot(null), revision: 0 };
        const localChanges = summarizeSnapshotChanges(accountState.payload, local, { compareAccount: true });
        if (remote && !localChanges.length && serializeMeaningfulSnapshot(accountState.payload) === serializeMeaningfulSnapshot(local)) {
          if (serializeSnapshot(accountState.payload) !== serializeSnapshot(local)) {
            revision = await writeRemote(local, accountState.revision);
          } else {
            revision = accountState.revision;
          }
          if (activeUserId !== userId) return;
          lastLocalSnapshot = JSON.stringify(local);
          localChangesPending = localChangeRevision !== localRevision;
          updateState({ status: localChangesPending ? 'local-pending' : 'synced', revision, pendingChoice: null, localChanges: [], error: '' });
          return;
        }
        updateState({ status: 'needs-choice', pendingChoice: { local, remote: accountState, localChanges, localRevision }, localChanges, revision: accountState.revision });
      } catch (error) {
        if (controller.signal.aborted) {
          if (activeUserId === userId) {
            updateState({ status: localChangesPending ? 'local-pending' : 'connected', pendingChoice: null, error: '' });
          }
          return;
        }
        if (error.code === AGE_CONFIRMATION_CANCELLED) {
          initialized = true;
          updateState({ status: 'connected', error: '', warning: '', restoreProgress: null });
          return;
        }
        if (activeUserId === userId) updateState({ status: 'error', error: error.message, restoreProgress: null });
        throw error;
      }
    })();
    syncPromise = operation;
    try {
      await operation;
    } finally {
      if (syncPromise === operation) syncPromise = null;
      if (syncAbortController === controller) syncAbortController = null;
    }
  },
  async resolveInitialChoice(choice) {
    const pending = state.pendingChoice;
    if (!pending) return;
    if (choice === 'cancel') {
      updateState({ status: 'local-pending', pendingChoice: null });
      return;
    }
    const userId = activeUserId;
    updateState({ status: 'syncing', pendingChoice: null, error: '' });
    try {
      const currentRevision = await fetchRemoteRevision(userId);
      if (activeUserId !== userId) return;
      if (currentRevision !== pending.remote.revision || localChangeRevision !== pending.localRevision) {
        updateState({ status: 'local-pending', error: 'Los datos cambiaron. Sincroniza de nuevo para revisarlos.' });
        return;
      }
      let warning = '';
      if (choice === 'cloud') {
        warning = await applySnapshot(pending.remote.payload);
        revision = pending.remote.revision;
      } else if (choice === 'backup') {
        revision = await writeRemote(pending.local, pending.remote.revision);
        lastLocalSnapshot = JSON.stringify(pending.local);
      } else return;
      if (choice !== 'cloud') localStorage.setItem(ACCOUNT_KEY, userId);
      initialized = true;
      localChangesPending = localChangeRevision !== pending.localRevision;
      backupImportPending = false;
      localStorage.removeItem(BACKUP_PENDING_KEY);
      updateState({ status: localChangesPending ? 'local-pending' : 'synced', revision, warning, localChanges: [] });
    } catch (error) {
      if (error.code === AGE_CONFIRMATION_CANCELLED) {
        updateState({ status: 'needs-choice', pendingChoice: pending, error: '', restoreProgress: null });
        return;
      }
      updateState({ status: 'local-pending', error: error.code === '40001' ? 'Los datos de la cuenta cambiaron. Sincroniza de nuevo para revisarlos.' : error.message, restoreProgress: null });
    }
  }
};
