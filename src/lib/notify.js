import { api } from './api.js';
import { lib } from './library.js';
import { settings } from './settings.js';
import { chapterIndex } from './chapterIndex.js';
import { setHttpGetBatchWindow } from './browserHttp.js';

const key = (url, sourceId) => `${sourceId}|${url}`;
const CHECK_BATCH_SIZE = 50;

let running = false;

async function countChapters(manga) {
  const sourceId = manga.sourceId || 'leercapitulo';
  const chapters = await api.refreshChapters(manga.url, sourceId);
  if (!Array.isArray(chapters) || !chapters.length) return null;
  chapterIndex.set(manga.url, sourceId, chapters.map((chapter) => chapter.url));
  return chapters.length;
}

export async function checkLibrary({ onProgress } = {}) {
  if (running) return [];
  if (typeof window === 'undefined') return [];

  const favs = lib.favs();
  if (!favs.length) {
    onProgress?.({ current: 0, total: 0 });
    return [];
  }

  running = true;
  onProgress?.({ current: 0, total: favs.length });
  const baseline = { ...(settings.get().notifyBaseline || {}) };
  const found = [];
  let cursor = 0;
  let completed = 0;
  const restoreBatchWindow = setHttpGetBatchWindow(250);

  try {
    // Keep update checks responsive while still combining requests queued together.
    await Promise.all(Array.from({ length: Math.min(CHECK_BATCH_SIZE, favs.length) }, async () => {
      while (cursor < favs.length) {
        const manga = favs[cursor++];
        try {
          const sourceId = manga.sourceId || 'leercapitulo';
          const k = key(manga.url, sourceId);
          const total = await countChapters({ ...manga, sourceId });
          if (total != null) {
            const prev = baseline[k];
            baseline[k] = total;
            if (prev != null && total > prev) {
              found.push({ url: manga.url, sourceId, title: manga.title, count: total - prev, last: total });
            }
          }
        } catch {} finally {
          completed += 1;
          onProgress?.({ current: completed, total: favs.length });
        }
      }
    }));
    settings.set({ notifyBaseline: baseline });
    return found;
  } finally {
    restoreBatchWindow();
    running = false;
  }
}
