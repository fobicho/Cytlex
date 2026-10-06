import { api } from './api.js';
import { lib } from './library.js';
import { settings } from './settings.js';
import { extUpdates } from './extUpdates.js';

const key = (url, sourceId) => `${sourceId}|${url}`;

let running = false;
let lastRun = 0;

async function finishIfBackground() {
  try {
    const bg = await window.cytlex.isBackground();
    if (bg) window.cytlex.exitBackground();
  } catch {}
}

async function avisarExtensiones() {
  if (!settings.get().extUpdateNotify) return false;
  const nuevos = await extUpdates.check();
  if (!nuevos.length) return false;

  const titulo =
    nuevos.length === 1
      ? `${nuevos[0].name} tiene actualización`
      : `${nuevos.length} extensiones tienen actualización`;
  const cuerpo =
    nuevos.length === 1
      ? `Ya puedes instalar la versión ${nuevos[0].to}.`
      : 'Ya puedes instalarlas desde Extensiones.';

  // Solo se marca si el sistema acepto el aviso: si lo descarto, la
  // proxima pasada vuelve a intentarlo.
  const enviado = await window.cytlex.notify({
    title: titulo,
    body: cuerpo,
    tipo: 'extensiones'
  });
  if (enviado) extUpdates.markSeen(nuevos);
  return !!enviado;
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

const HOURS = [6, 12, 24];

const TARGET_HOURS = {
  6: [0, 6, 12, 18],
  12: [0, 12],
  24: [12]
};

export function notifyHours() {
  const h = Number(settings.get().notifyHours);
  return HOURS.includes(h) ? h : 6;
}

function msToNextHour(hours) {
  const list = TARGET_HOURS[hours] || TARGET_HOURS[6];
  const now = new Date();
  for (const h of list) {
    const t = new Date(now);
    t.setHours(h, 0, 0, 0);
    if (t > now) return Math.max(1000, t - now);
  }
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  t.setHours(list[0], 0, 0, 0);
  return Math.max(1000, t - now);
}

export function startNotifier() {
  // Cada aviso va por su propio interruptor: el de extensiones no depende
  // de que esté activo el de capítulos, ni al revés.
  const run = async () => {
    const cfg = settings.get();
    const quiereLib = cfg.notifyEnabled;
    const quiereExt = cfg.extUpdateNotify;
    if (!quiereLib && !quiereExt) {
      finishIfBackground();
      return;
    }
    if (quiereLib) await checkLibrary().catch(() => {});
    const avisado = quiereExt ? await avisarExtensiones().catch(() => false) : false;
    if (!avisado) {
      finishIfBackground();
      return;
    }
    setTimeout(finishIfBackground, 4 * 60 * 1000);
  };

  let id = null;
  const wanted = () => settings.get().notifyEnabled || settings.get().extUpdateNotify;

  const arm = () => {
    if (id) clearTimeout(id);
    id = null;
    if (!wanted()) return;
    id = setTimeout(() => {
      run();
      arm();
    }, msToNextHour(notifyHours()));
  };

  arm();
  const off = settings.subscribe(arm);

  const bg = window.cytlex?.isBackground?.();
  if (bg && typeof bg.then === 'function') {
    bg.then((v) => {
      if (v) setTimeout(run, 2500);
    });
  }

  return () => {
    if (id) clearTimeout(id);
    off();
  };
}

export function onNotifyClick(cb) {
  if (typeof window === 'undefined' || !window.cytlex?.onNotifyClick) return () => {};
  return window.cytlex.onNotifyClick(cb);
}
