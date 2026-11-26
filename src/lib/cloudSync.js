import { createClient } from '@supabase/supabase-js';
import { libraryKey, lib } from './library.js';
import { progress } from './progress.js';
import { extensions, isExtensionAllowed, EXTENSION_INSTALLED_EVENT } from './extensions.js';
import { settings } from './settings.js';
import { CLOUD_SYNC_LOCAL_CHANGE_EVENT } from './cloudSyncEvents.js';

const TABLE = 'cytlex_sync_state';
const ACCOUNT_KEY = 'cytlex:cloud-sync-account:v1';
const TOMBSTONES_KEY = 'cytlex:cloud-sync-tombstones:v1';
const DEFAULT_REPOSITORY = 'https://fobicho.github.io/Cytlex/index.json';
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
  warning: ''
};
let started = false;
let stopAuth = null;
let channel = null;
let activeUserId = '';
let initializingUserId = '';
let revision = 0;
let initialized = false;
let applying = false;
let saving = false;
let saveTimer = null;
let lastLocalSnapshot = '';
let pendingRemote = null;

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

const mangaKey = (manga) => libraryKey(manga.url, manga.sourceId || 'leercapitulo');

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
    else favorites.set(key,
      Number(manga.updatedAt || manga.savedAt) >= Number(current.updatedAt || current.savedAt) ? manga : current
    );
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
  const favoriteRows = [...favorites.entries()].filter(([key, manga]) => Number(manga.savedAt || 0) > (Number(tombstones.favorites[key]) || 0));
  const categoryRows = [...categories.entries()].filter(([id, category]) => id === 'todos' || Number(category.updatedAt || 0) > (Number(tombstones.categories[id]) || 0));
  const progressRows = Object.entries(mergedProgress).filter(([key, entry]) => Number(entry?.updatedAt || entry?.readAt || 0) > (Number(tombstones.progress[key]) || 0));
  const extensionRows = [...installed.entries()].filter(([id, item]) => Number(item.installedAt || 0) > (Number(tombstones.extensions[id]) || 0));
  return {
    schemaVersion: 1,
    favorites: favoriteRows.map(([, manga]) => manga),
    categories: categoryRows.map(([, category]) => category),
    progress: Object.fromEntries(progressRows),
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

const hasLocalData = (snapshot) => snapshot.favorites.length > 0
  || Object.keys(snapshot.progress).length > 0
  || snapshot.extensions.length > 0
  || snapshot.categories.some((category) => category.id !== 'todos');

async function fetchRemote(userId) {
  const { data, error } = await client.from(TABLE)
    .select('payload, revision')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? { payload: normalizeSnapshot(data.payload), revision: data.revision } : null;
}

async function reconcileExtensions(snapshot) {
  const desired = normalizeSnapshot(snapshot).extensions;
  const targetIds = new Set(desired.map((item) => item.id));
  const current = extensions.installed();
  if (!desired.length) {
    await Promise.all(current.map(({ manifest }) => extensions.uninstall(manifest.id)));
    return '';
  }

  const repoUrl = settings.get().extIndexUrl?.trim() || DEFAULT_REPOSITORY;
  let repository;
  try {
    repository = await extensions.repoIndex(repoUrl, { refresh: true });
  } catch (error) {
    return `No se pudo consultar el repositorio de extensiones: ${error.message}`;
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

  const removable = current.filter(({ manifest }) => !targetIds.has(manifest.id));
  await Promise.all(removable.map(({ manifest }) => extensions.uninstall(manifest.id)));
  const installedIds = [];
  for (const [id, manifest] of manifests) {
    const installed = extensions.installed().find((record) => record.manifest.id === id);
    if (installed && String(installed.installedVersion || installed.manifest.version || '0') === String(manifest.version || '0')) continue;
    try {
      await extensions.install(manifest, repoUrl, { backfillLibrary: false });
      installedIds.push(id, ...(manifest.config?.sources || []).map((source) => source.id));
    } catch {
      missing.push(id);
    }
  }

  if (installedIds.length) window.dispatchEvent(new CustomEvent(EXTENSION_INSTALLED_EVENT, { detail: { sourceIds: installedIds } }));
  return [
    blocked.length ? `No se restauraron extensiones bloqueadas por los ajustes de contenido: ${blocked.join(', ')}.` : '',
    missing.length ? `No se encontraron versiones disponibles para: ${[...new Set(missing)].join(', ')}.` : ''
  ].filter(Boolean).join(' ');
}

async function applySnapshot(value, { syncExtensions = true } = {}) {
  const snapshot = normalizeSnapshot(value);
  applying = true;
  try {
    const warning = syncExtensions ? await reconcileExtensions(snapshot) : '';
    localStorage.setItem('cytlex:cats:v1', JSON.stringify(snapshot.categories));
    localStorage.setItem('cytlex:favs', JSON.stringify(snapshot.favorites));
    localStorage.setItem('cytlex:progress:v1', JSON.stringify(snapshot.progress));
    localStorage.setItem(tombstonesStorageKey(), JSON.stringify(snapshot.tombstones));
    progress.reload();
    window.dispatchEvent(new Event('cytlex:library-updated'));
    window.dispatchEvent(new Event('cytlex:source-config-changed'));
    lastLocalSnapshot = JSON.stringify(localSnapshot());
    return warning;
  } finally {
    applying = false;
  }
}

async function writeRemote(payload, expectedRevision) {
  const { data, error } = await client.rpc('save_cytlex_sync_state', {
    p_payload: payload,
    p_expected_revision: expectedRevision
  });
  if (error) throw error;
  return Number(data);
}

async function persistSnapshot(payload, expectedRevision, retries = 1) {
  try {
    const nextRevision = await writeRemote(payload, expectedRevision);
    revision = nextRevision;
    updateState({ revision, status: 'synced', error: '', warning: '' });
    lastLocalSnapshot = JSON.stringify(localSnapshot());
    return payload;
  } catch (error) {
    if (error.code !== '40001' || retries <= 0) throw error;
    const remote = await fetchRemote(activeUserId);
    if (!remote) throw error;
    revision = remote.revision;
    const merged = mergeSnapshots(payload, remote.payload);
    const warning = await applySnapshot(merged);
    updateState({ warning });
    return persistSnapshot(merged, remote.revision, retries - 1);
  }
}

async function onRemoteUpdate() {
  if (!activeUserId || saving || state.pendingChoice) return;
  try {
    const remote = await fetchRemote(activeUserId);
    if (!remote || remote.revision <= revision) return;
    revision = remote.revision;
    if (saveTimer) {
      const merged = mergeSnapshots(localSnapshot(), remote.payload);
      const warning = await applySnapshot(merged);
      updateState({ warning, revision });
      await persistSnapshot(merged, revision);
      return;
    }
    const warning = await applySnapshot(remote.payload);
    lastLocalSnapshot = JSON.stringify(localSnapshot());
    updateState({ revision, status: 'synced', warning, error: '' });
  } catch (error) {
    updateState({ error: error.message, status: 'error' });
  }
}

async function initializeUser(user) {
  if (user.id === activeUserId && (initialized || initializingUserId === user.id)) return;
  activeUserId = user.id;
  initializingUserId = user.id;
  initialized = false;
  revision = 0;
  updateState({ email: user.email || '', status: 'loading', error: '', warning: '', pendingChoice: null });
  try {
    const [remote, local] = await Promise.all([fetchRemote(user.id), Promise.resolve(localSnapshot())]);
    if (activeUserId !== user.id) return;
    const previousAccount = localStorage.getItem(ACCOUNT_KEY);
    if (!remote) {
      const payload = normalizeSnapshot(local);
      await persistSnapshot(payload, 0);
      localStorage.setItem(ACCOUNT_KEY, user.id);
    } else if (!hasLocalData(local)) {
      revision = remote.revision;
      const warning = await applySnapshot(remote.payload);
      localStorage.setItem(ACCOUNT_KEY, user.id);
      initialized = true;
      updateState({ status: 'synced', revision, warning });
    } else if (previousAccount === user.id) {
      revision = remote.revision;
      const merged = mergeSnapshots(local, remote.payload);
      const warning = await applySnapshot(merged);
      await persistSnapshot(merged, remote.revision);
      localStorage.setItem(ACCOUNT_KEY, user.id);
      initialized = true;
      updateState({ status: 'synced', revision, warning });
    } else {
      updateState({
        status: 'needs-choice',
        pendingChoice: { local, remote },
        revision: remote.revision
      });
    }
    if (state.status !== 'needs-choice') initialized = true;
    if (state.status === 'needs-choice') return;
    channel?.unsubscribe();
    channel = client.channel(`cytlex-sync-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `user_id=eq.${user.id}` }, () => { void onRemoteUpdate(); })
      .subscribe();
  } catch (error) {
    if (activeUserId === user.id) updateState({ status: 'error', error: error.message });
  } finally {
    if (initializingUserId === user.id) initializingUserId = '';
  }
}

async function saveLocalChanges() {
  if (!client || !activeUserId || !initialized || applying || saving || state.pendingChoice) return;
  const current = localSnapshot();
  const serialized = JSON.stringify(current);
  if (serialized === lastLocalSnapshot) return;
  saving = true;
  updateState({ status: 'saving', error: '' });
  try {
    await persistSnapshot(current, revision);
    localStorage.setItem(ACCOUNT_KEY, activeUserId);
  } catch (error) {
    updateState({ status: 'error', error: error.message });
  } finally {
    saving = false;
  }
}

function onLocalChange() {
  if (!activeUserId || !initialized || applying || state.pendingChoice) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const current = trackLocalDeletions(localSnapshot());
    lastLocalSnapshot = lastLocalSnapshot || JSON.stringify(current);
    void saveLocalChanges();
  }, 1500);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') void onRemoteUpdate();
}

export const cloudSync = {
  getState() { return state; },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  start() {
    if (!client || started) return () => {};
    started = true;
    window.addEventListener(CLOUD_SYNC_LOCAL_CHANGE_EVENT, onLocalChange);
    window.addEventListener('online', onLocalChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    const auth = client.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        updateState({ email: session.user.email || '', status: 'loading', error: '' });
        window.setTimeout(() => { void initializeUser(session.user); }, 0);
      } else if (event === 'SIGNED_OUT') {
        activeUserId = '';
        initializingUserId = '';
        initialized = false;
        revision = 0;
        channel?.unsubscribe();
        channel = null;
        updateState({ email: '', status: 'signed-out', revision: 0, pendingChoice: null, error: '', warning: '' });
      }
    });
    stopAuth = () => auth.data.subscription.unsubscribe();
    return () => {
      window.removeEventListener(CLOUD_SYNC_LOCAL_CHANGE_EVENT, onLocalChange);
      window.removeEventListener('online', onLocalChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(saveTimer);
      channel?.unsubscribe();
      channel = null;
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
  async signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
  },
  async syncNow() {
    if (!activeUserId || !initialized) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    await saveLocalChanges();
    if (activeUserId) await onRemoteUpdate();
  },
  async resolveInitialChoice(choice) {
    const pending = state.pendingChoice;
    if (!pending) return;
    if (choice === 'local') {
      await this.signOut();
      return;
    }
    const userId = activeUserId;
    let payload = choice === 'cloud' ? pending.remote.payload : mergeSnapshots(pending.local, pending.remote.payload);
    revision = pending.remote.revision;
    updateState({ status: 'loading', pendingChoice: null, error: '' });
    try {
      const warning = await applySnapshot(payload);
      await persistSnapshot(payload, revision);
      localStorage.setItem(ACCOUNT_KEY, userId);
      initialized = true;
      updateState({ status: 'synced', revision, warning });
      channel?.unsubscribe();
      channel = client.channel(`cytlex-sync-${userId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLE, filter: `user_id=eq.${userId}` }, () => { void onRemoteUpdate(); })
        .subscribe();
    } catch (error) {
      updateState({ status: 'error', error: error.message, pendingChoice: pending });
    }
  }
};
