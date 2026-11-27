import { anilistList } from './anilist.js';
import { progress } from './progress.js';
import { tracking } from './tracking.js';
import { session } from './session.js';
import { comickList } from './comick.js';
import { comickSession } from './comickSession.js';

const DEBOUNCE_MS = 2000;
const GONE = 30 * 24 * 60 * 60 * 1000;

const chapterNumber = (title) => {
  const m = String(title || '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const SEED_KEY = 'cytlex:anilistSeeded';

export function seedFromAniList(anilistId) {
  if (!anilistId) return;
  try {
    const data = JSON.parse(localStorage.getItem(SEED_KEY)) || {};
    if (data[anilistId]) return;
    data[anilistId] = true;
    localStorage.setItem(SEED_KEY, JSON.stringify(data));
  } catch {}
}

let timer = null;
let pending = new Map();
let inFlight = false;

async function flush() {
  if (!pending.size || inFlight) return;
  const tasks = [...pending.values()];
  pending.clear();
  inFlight = true;
  try {
    for (const task of tasks) {
      try {
        await task();
      } catch (e) {
        console.warn('[Cytlex] no se pudo sincronizar el seguimiento:', e?.message || e);
      }
    }
  } finally {
    inFlight = false;
    if (pending.size) void flush();
  }
}

const schedule = (key, task) => {
  pending.set(key, task);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, DEBOUNCE_MS);
};

function bestChapter(chapters, sourceId) {
  let best = null;
  for (const c of chapters) {
    const n = chapterNumber(c.title);
    if (n == null) continue;
    const cap = progress.get(c.url, sourceId);
    if (!cap?.read) continue;
    if (best == null || n > best.n) best = { n, url: c.url, title: c.title };
  }
  return best;
}

function comickProgressNumber(entry) {
  const value = entry?.progress?.number;
  if (value == null || String(value).trim() === '') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

export const sync = {
  pushChapter({ mangaUrl, sourceId, chapters }) {
    const linked = tracking.get(mangaUrl, sourceId);
    if (!linked?.id && !linked?.comickId) return;

    const best = bestChapter(chapters, sourceId);
    if (!best) return;

    if (linked.id) schedule(`anilist:${linked.id}`, async () => {
      const st = await session.status();
      if (!st.connected) return;
      const entry = await anilistList.entry(linked.id);
      if (entry && entry.progress >= best.n) return;
      await anilistList.saveEntry({ mediaId: linked.id, entryId: entry?.entryId, progress: best.n });
    });

    if (linked.comickId) schedule(`comick:${linked.comickId}`, async () => {
      const st = comickSession.status();
      if (!st.connected || !st.canWrite) return;
      const entry = await comickList.entry(linked.comickId);
      const current = comickProgressNumber(entry);
      if (current != null && current >= best.n) return;
      await comickList.saveEntry({
        hid: linked.comickId,
        progress: { number: String(best.n) }
      });
    });
  },

  async pushNow({ mangaUrl, sourceId, chapters }) {
    const linked = tracking.get(mangaUrl, sourceId);
    if (!linked?.id && !linked?.comickId) return;
    const best = bestChapter(chapters, sourceId);
    if (!best) return;
    const tasks = [];
    if (linked.id) tasks.push((async () => {
      const st = await session.status();
      if (!st.connected) return;
      const entry = await anilistList.entry(linked.id);
      if (entry && entry.progress >= best.n) return;
      await anilistList.saveEntry({ mediaId: linked.id, entryId: entry?.entryId, progress: best.n });
    })());
    if (linked.comickId) tasks.push((async () => {
      const st = comickSession.status();
      if (!st.connected || !st.canWrite) return;
      const entry = await comickList.entry(linked.comickId);
      const current = comickProgressNumber(entry);
      if (current != null && current >= best.n) return;
      await comickList.saveEntry({ hid: linked.comickId, progress: { number: String(best.n) } });
    })());
    await Promise.all(tasks);
  }
};

