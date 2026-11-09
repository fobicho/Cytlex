import { lib } from './library.js';
import { progress } from './progress.js';
import { chapterIndex } from './chapterIndex.js';
import { chapterOrder } from './searchState.js';
import { tracking } from './tracking.js';
import { extensions } from './extensions.js';

const norm = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

function chapterNumber(chapter) {
  const direct = Number(chapter?.number ?? chapter?.chapterNumber);
  if (Number.isFinite(direct) && direct !== 0) return direct;
  for (const value of [chapter?.title, chapter?.name, chapter?.url]) {
    const match = String(value || '').match(/(?:chapter|cap[ií]tulo|cap\.?|ch\.?)\s*[-#:]?\s*(-?\d+(?:[.,]\d+)?)/i)
      || String(value || '').match(/^\s*(-?\d+(?:[.,]\d+)?)(?:\s|$)/);
    if (!match) continue;
    const parsed = Number(match[1].replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function uniqueIndex(chapters, getKey) {
  const grouped = new Map();
  chapters.forEach((chapter) => {
    const key = getKey(chapter);
    if (!key || !chapter.url) return;
    const matches = grouped.get(key) || [];
    matches.push(chapter);
    grouped.set(key, matches);
  });
  return new Map([...grouped].filter(([, matches]) => matches.length === 1).map(([key, [chapter]]) => [key, chapter]));
}

export function reconcileChapterProgress(previousChapters, nextChapters, previousSourceId, nextSourceId, mangaUrl, clearMatchedPrevious = false) {
  if (!Array.isArray(previousChapters) || !Array.isArray(nextChapters)) return;
  const titleKey = (chapter) => norm(chapter.title || chapter.name).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numberKey = (chapter) => {
    const number = chapterNumber(chapter);
    return number === null ? '' : String(number);
  };
  const previousByTitle = uniqueIndex(previousChapters, titleKey);
  const nextByTitle = uniqueIndex(nextChapters, titleKey);
  const previousByNumber = uniqueIndex(previousChapters, numberKey);
  const nextByNumber = uniqueIndex(nextChapters, numberKey);
  const readUrls = [];
  const previousProgressToClear = [];
  const matchedTargets = new Set();

  previousChapters.forEach((previous) => {
    const next = nextByTitle.get(titleKey(previous)) || nextByNumber.get(numberKey(previous));
    if (!next || (next.url === previous.url && previousSourceId === nextSourceId) || matchedTargets.has(next.url)) return;
    matchedTargets.add(next.url);
    const previousProgress = progress.get(previous.url, previousSourceId);
    const nextProgress = progress.get(next.url, nextSourceId);
    if (previousProgress?.read && !nextProgress?.read) readUrls.push(next.url);
    else if (!nextProgress?.read && Number.isInteger(previousProgress?.page) && previousProgress.page > 0
      && previousProgress.page > (Number(nextProgress?.page) || 0)) {
      progress.savePage(next.url, nextSourceId, previousProgress.page, nextProgress?.total || previousProgress.total || 0);
    }
    if (clearMatchedPrevious && previousProgress) previousProgressToClear.push(previous.url);
  });

  if (readUrls.length) progress.markMany(readUrls, nextSourceId, null, mangaUrl);
  previousProgressToClear.forEach((url) => progress.remove(url, previousSourceId, mangaUrl));
}

export function migrateSavedManga({ fromUrl, fromSourceId, fromDetail, targetUrl, targetSourceId, targetDetail }) {
  const saved = lib.fav(fromUrl, fromSourceId);
  if (!saved) throw new Error('Este manga ya no está guardado en la biblioteca.');

  const targetChapters = targetDetail.chapters || [];
  const manifest = extensions.manifest(targetSourceId);
  const existingTarget = lib.fav(targetUrl, targetSourceId);
  const categories = [...new Set([...(saved.cats || []), ...(existingTarget?.cats || [])])];
  const nextManga = {
    url: targetUrl,
    title: targetDetail.title || fromDetail.title || saved.title,
    cover: targetDetail.cover || saved.cover,
    type: targetDetail.facts?.tipo || saved.type || 'Manga',
    genres: targetDetail.genres || saved.genres || [],
    author: targetDetail.facts?.autor || saved.author || '',
    sourceId: targetSourceId,
    sourceName: manifest.name,
    sourceIcon: manifest.icon
  };

  reconcileChapterProgress(fromDetail.chapters, targetChapters, fromSourceId, targetSourceId, targetUrl, true);
  chapterIndex.drop(fromUrl, fromSourceId);
  chapterIndex.set(targetUrl, targetSourceId, targetChapters.map((chapter) => chapter.url).filter(Boolean));
  if (existingTarget) {
    lib.updateFavCats(targetUrl, categories, targetSourceId);
    lib.toggleFav({ url: fromUrl, sourceId: fromSourceId });
  } else {
    lib.updateFav(fromUrl, {
      ...nextManga,
      cats: categories,
      savedAt: saved.savedAt || Date.now(),
      chapterTotal: targetChapters.length,
      coverLocal: '',
      coverCached: ''
    }, fromSourceId);
  }
  tracking.move(fromUrl, targetUrl, fromSourceId, targetSourceId);
  chapterOrder.move(fromUrl, targetUrl);
}
