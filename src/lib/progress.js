import { notifyCloudSyncLocalChange } from './cloudSyncEvents.js';

const KEY = 'cytlex:progress:v1';

let cache = null;
let cacheRaw;
let revision = 0;
let baseline = {};
const pending = new Map();
const removed = Symbol('removed');
let storageError = false;

const listeners = new Set();
const notify = (change) => listeners.forEach((l) => l(change));

const read = () => {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return cache || {}; }
  if (!cache || raw !== cacheRaw) {
    let stored;
    try { stored = JSON.parse(raw) ?? {}; } catch { stored = {}; }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
    cache = { ...stored };
    pending.forEach((value, key) => { if (value === removed) delete cache[key]; else cache[key] = value; });
    cacheRaw = raw;
  }
  return cache;
};
const edit = () => { baseline = { ...read() }; return { ...baseline }; };

const write = (data, type = 'progress') => {
  new Set([...Object.keys(baseline), ...Object.keys(data)]).forEach((key) => {
    if (!Object.hasOwn(data, key)) pending.set(key, removed);
    else if (data[key] !== baseline[key]) pending.set(key, data[key]);
  });
  const latest = { ...read() };
  pending.forEach((value, key) => { if (value === removed) delete latest[key]; else latest[key] = value; });
  revision += 1;
  try {
    const raw = JSON.stringify(latest);
    localStorage.setItem(KEY, raw);
    pending.clear();
    cache = latest;
    cacheRaw = raw;
    if (storageError) { storageError = false; notify({ type: 'storage-recovered' }); }
    notifyCloudSyncLocalChange({ type });
    return true;
  } catch {
    cache = latest;
    if (!storageError) { storageError = true; notify({ type: 'storage-error' }); }
    return false;
  }
};

const cap = (url, sourceId = 'leercapitulo') => `${sourceId}|${url}`;

function put(url, sourceId, patch, type = 'progress') {
  const data = edit();
  const k = cap(url, sourceId);
  const current = data[k] || {};
  const next = { ...current, ...patch, updatedAt: Date.now() };
  if (type === 'progress-page' && current.page === next.page && current.total === next.total && current.read === next.read) return;
  data[k] = next;
  write(data, type);
}

export const progress = {
  revision: () => revision,
  hasPendingWrites: () => pending.size > 0,
  retry() {
    if (!pending.size) return true;
    return write(edit());
  },

  reload() {
    cache = null;
    revision += 1;
    read();
    notify({ type: 'reset' });
  },

  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  get(url, sourceId = 'leercapitulo') {
    return read()[cap(url, sourceId)] || null;
  },

  savePage(url, sourceId, page, total) {
    if (!url) return;
    if (!Number.isInteger(page) || page < 0) return;
    const cur = read()[cap(url, sourceId)];
    if (cur?.read) return;
    put(url, sourceId, { page, total: total ?? cur?.total ?? 0, updatedAt: Date.now() }, 'progress-page');
  },

  markRead(url, sourceId, total = 0, mangaUrl = '') {
    if (!url) return;
    const wasRead = read()[cap(url, sourceId)]?.read;
    put(url, sourceId, { page: null, total, read: true, readAt: Date.now() });
    if (!wasRead) notify({ type: 'read', mangaUrl, sourceId });
  },

  markMany(urls, sourceId, total = null, mangaUrl = '') {
    const list = (urls || []).filter(Boolean);
    if (!list.length) return;
    const data = edit();
    const now = Date.now();
    let changed = false;
    list.forEach((url) => {
      const key = cap(url, sourceId);
      const previous = data[key] || {};
      if (!previous.read) changed = true;
      data[key] = { ...previous, page: null, total: total ?? previous.total ?? 0, read: true, readAt: now, updatedAt: now };
    });
    write(data);
    if (changed) notify({ type: 'read', mangaUrl, sourceId });
  },

  markUnread(url, sourceId, mangaUrl = '') {
    if (!url) return;
    const cur = read()[cap(url, sourceId)];
    if (!cur) return;
    put(url, sourceId, { read: false, readAt: null, page: null });
    if (cur.read) notify({ type: 'read', mangaUrl, sourceId });
  },

  remove(url, sourceId, mangaUrl = '') {
    const data = edit();
    const wasRead = data[cap(url, sourceId)]?.read;
    delete data[cap(url, sourceId)];
    write(data);
    if (wasRead) notify({ type: 'read', mangaUrl, sourceId });
  },

  removeMany(urls, sourceId, mangaUrl = '') {
    const data = edit();
    let changed = false;
    let wasRead = false;
    [...new Set((urls || []).filter(Boolean))].forEach((url) => {
      const key = cap(url, sourceId);
      if (!Object.hasOwn(data, key)) return;
      wasRead ||= data[key]?.read;
      delete data[key];
      changed = true;
    });
    if (!changed) return;
    write(data);
    if (wasRead) notify({ type: 'read', mangaUrl, sourceId });
  },

  reassignSource(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    const data = edit();
    const prefix = `${oldId}|`;
    let changed = false;
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith(prefix)) continue;
      const nextKey = `${newId}|${key.slice(prefix.length)}`;
      data[nextKey] = { ...(data[nextKey] || {}), ...value };
      delete data[key];
      changed = true;
    }
    if (changed) {
      write(data);
      notify({ type: 'reset', sourceId: newId });
    }
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return;
    cache = null;
    revision += 1;
    notify({ type: 'reset' });
    notifyCloudSyncLocalChange({ type: 'progress' });
  });
}

