import { extensions, DEFAULT_INDEX_URL } from './extensions.js';
import { settings } from './settings.js';

const KEY = 'cytlex:ext-notified:v1';
const listeners = new Set();

const readNotified = () => {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
};

const writeNotified = (v) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
};

const repoUrl = () => settings.get().extIndexUrl || DEFAULT_INDEX_URL;

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
    checking = true;
    try {
      const found = await extensions.checkUpdates(repoUrl());
      const yaAvisadas = readNotified();
      const nuevos = found.filter((u) => yaAvisadas[u.id] !== u.to);
      if (nuevos.length) {
        writeNotified({ ...yaAvisadas, ...Object.fromEntries(nuevos.map((u) => [u.id, u.to])) });
        listeners.forEach((l) => l());
      }
      return nuevos;
    } catch {
      return [];
    } finally {
      checking = false;
    }
  },

  get pendingCount() {
    return Object.keys(readNotified()).length;
  }
};

export async function announceExtUpdates(onNew) {
  const nuevos = await extUpdates.check();
  if (!nuevos.length) return [];
  const titulo =
    nuevos.length === 1
      ? `${nuevos[0].name} tiene actualización`
      : `${nuevos.length} extensiones tienen actualización`;
  const cuerpo = nuevos.length === 1
    ? `Ya puedes instalar la versión ${nuevos[0].to}.`
    : 'Ya puedes instalarlas desde Extensiones.';
  onNew({ titulo, cuerpo, count: nuevos.length });
  return nuevos;
}
