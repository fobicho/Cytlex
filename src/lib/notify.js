import { api } from './api.js';
import { lib } from './library.js';
import { settings } from './settings.js';

const key = (url, sourceId) => `${sourceId}|${url}`;

let running = false;
let lastRun = 0;

async function finishIfBackground() {
  try {
    const bg = await window.cytlex.isBackground();
    if (bg) window.cytlex.exitBackground();
  } catch {}
}

async function countChapters(manga) {
  const d = await api.detail(manga.url, manga.sourceId || 'leercapitulo');
  return Array.isArray(d?.chapters) ? d.chapters.length : null;
}

export async function checkLibrary({ silent = false, force = false } = {}) {
  if (running) return [];
  if (typeof window === 'undefined' || !window.cytlex?.notify) return [];
  const cfg = settings.get();
  if (!force && Date.now() - lastRun < 10 * 60 * 1000) return [];
  lastRun = Date.now();

  if (!cfg.notifyEnabled && !silent) {
    await finishIfBackground();
    return [];
  }

  const favs = lib.favs();
  if (!favs.length) {
    await finishIfBackground();
    return [];
  }

  running = true;
  const baseline = { ...(cfg.notifyBaseline || {}) };
  const found = [];
  let checked = 0;

  for (const m of favs) {
    const sourceId = m.sourceId || 'leercapitulo';
    const k = key(m.url, sourceId);
    let total = null;
    try {
      total = await countChapters({ ...m, sourceId });
    } catch {
      continue;
    }
    if (total == null) continue;

    checked++;
    const prev = baseline[k];
    baseline[k] = total;

    if (prev != null && total > prev) {
      found.push({ url: m.url, sourceId, title: m.title, count: total - prev, last: total });
    }
  }

  settings.set({ notifyBaseline: baseline });

  if (found.length === 0 && !silent) {
    try {
      const sent = await window.cytlex.notify({
        title: 'Biblioteca al día',
        body: checked === 1 ? '1 obra revisada, sin novedades' : `${checked} obras revisadas, sin novedades`
      });
      console.log('[notify] sin novedades, enviado:', sent);
    } catch (e) {
      console.log('[notify] sin novedades, error:', e);
    }
  }

  for (const f of found) {
    if (silent) continue;
    const n = f.count;
    try {
      await window.cytlex.notify({
        title: f.title || 'Manga de tu biblioteca',
        body: n === 1 ? '1 capítulo nuevo disponible' : `${n} capítulos nuevos disponibles`,
        key: key(f.url, f.sourceId),
        url: f.url,
        sourceId: f.sourceId
      });
    } catch {}
  }

  running = false;
  if (!silent) await finishIfBackground();
  return found;
}

export function startNotifier() {
  const run = () => {
    if (!settings.get().notifyEnabled) {
      finishIfBackground();
      return;
    }
    checkLibrary().catch(() => {});
  };

  let id = null;
  const arm = () => {
    if (id) clearInterval(id);
    id = null;
    if (!settings.get().notifyEnabled) return;
    const min = Math.max(settings.get().notifyInterval || 60, 15);
    id = setInterval(run, min * 60 * 1000);
  };

  arm();
  const off = settings.subscribe(arm);

  const bg = window.cytlex?.isBackground?.();
  if (bg && typeof bg.then === 'function') {
    bg.then((v) => {
      if (v) setTimeout(run, 2500);
    });
  } else {
    setTimeout(run, 4000);
  }

  return () => {
    if (id) clearInterval(id);
    off();
  };
}

export function onNotifyClick(cb) {
  if (typeof window === 'undefined' || !window.cytlex?.onNotifyClick) return () => {};
  return window.cytlex.onNotifyClick(cb);
}
