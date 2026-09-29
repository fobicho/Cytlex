import { anilistList } from './anilist.js';
import { progress } from './progress.js';
import { tracking } from './tracking.js';
import { session } from './session.js';

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
let pending = null;
let inFlight = false;

async function flush() {
  if (!pending || inFlight) return;
  const task = pending;
  pending = null;
  inFlight = true;
  try {
    await task();
  } catch (e) {
    console.warn('[Cytlex] no se pudo sincronizar con AniList:', e?.message || e);
  } finally {
    inFlight = false;
    if (pending) flush();
  }
}

const schedule = (task) => {
  pending = task;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
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

export const sync = {
  pushChapter({ mangaUrl, sourceId, chapters }) {
    const linked = tracking.get(mangaUrl, sourceId);
    if (!linked?.id) return;

    const best = bestChapter(chapters, sourceId);
    if (!best) return;

    schedule(async () => {
      const st = await session.status();
      if (!st.connected) return;
      const entry = await anilistList.entry(linked.id);
      if (entry && entry.progress >= best.n) return;
      await anilistList.saveEntry({
        mediaId: linked.id,
        entryId: entry?.entryId,
        progress: best.n
      });
    });
  },

  async pushNow({ mangaUrl, sourceId, chapters }) {
    const linked = tracking.get(mangaUrl, sourceId);
    if (!linked?.id) return;
    const best = bestChapter(chapters, sourceId);
    if (!best) return;
    const st = await session.status();
    if (!st.connected) return;
    const entry = await anilistList.entry(linked.id);
    if (entry && entry.progress >= best.n) return;
    await anilistList.saveEntry({ mediaId: linked.id, entryId: entry?.entryId, progress: best.n });
  }
};

