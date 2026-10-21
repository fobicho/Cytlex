import { extensions } from './extensions.js';
import { settings } from './settings.js';

const KEY = 'cytlex:ext-notified:v1';
const listeners = new Set();

const readNotified = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};

const writeNotified = (v) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
};

const repoUrl = () => (settings.get().extIndexUrl || '').trim();

let checking = false;

export const extUpdates = {
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  pending() {
    return readNotified();
  },

  clear() {
    writeNotified({});
    listeners.forEach((l) => l());
  },

  async check() {
    if (checking) return [];
    if (typeof window === 'undefined' || !window.cytlex?.httpGet) return [];
    const url = repoUrl();
    if (!url) return [];
    checking = true;
    try {
      const found = await extensions.checkUpdates(url);
      const yaAvisadas = readNotified();
      return found.filter((u) => yaAvisadas[u.id] !== u.to);
    } catch {
      return [];
    } finally {
      checking = false;
    }
  },

  markSeen(updates) {
    const list = Array.isArray(updates) ? updates : [updates];
    if (!list.length) return;
    writeNotified({
      ...readNotified(),
      ...Object.fromEntries(list.map((u) => [u.id, u.to]))
    });
    listeners.forEach((l) => l());
  },

  get pendingCount() {
    return Object.keys(readNotified()).length;
  }
};

export async function announceExtUpdates(onNew) {
  const url = repoUrl();
  if (!url) return [];
  let nuevos = [];
  try {
    nuevos = await extensions.checkUpdates(url);
  } catch {
    return [];
  }
  if (!nuevos.length) return [];
  onNew({ updates: nuevos, count: nuevos.length });
  return nuevos;
}
