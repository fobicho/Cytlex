import { lib } from './library.js';
import { progress } from './progress.js';
import { chapterIndex } from './chapterIndex.js';
import { chapterOrder } from './searchState.js';
import { tracking } from './tracking.js';
import { extensions } from './extensions.js';

const norm = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function reconcileChapterProgress(previousChapters, nextChapters, previousSourceId, nextSourceId, mangaUrl) {
  if (!Array.isArray(previousChapters) || !Array.isArray(nextChapters)) return;
  const indexUniqueTitles = (chapters) => {
    const grouped = new Map();
    chapters.forEach((chapter) => {
      const title = norm(chapter.title || chapter.name).normalize('NFKC').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (!title || !chapter.url) return;
      const matches = grouped.get(title) || [];
      matches.push(chapter);
      grouped.set(title, matches);
    });
    return new Map([...grouped].filter(([, matches]) => matches.length === 1).map(([title, [chapter]]) => [title, chapter]));
  };
  const previousByTitle = indexUniqueTitles(previousChapters);
  const nextByTitle = indexUniqueTitles(nextChapters);
  const readUrls = [];

  previousByTitle.forEach((previous, title) => {
    const next = nextByTitle.get(title);
    if (!next || next.url === previous.url) return;
    const previousProgress = progress.get(previous.url, previousSourceId);
    const nextProgress = progress.get(next.url, nextSourceId);
    if (previousProgress?.read && !nextProgress?.read) readUrls.push(next.url);
    else if (!nextProgress && Number.isInteger(previousProgress?.page) && previousProgress.page > 0) {
      progress.savePage(next.url, nextSourceId, previousProgress.page, previousProgress.total || 0);
    }
  });

  if (readUrls.length) progress.markMany(readUrls, nextSourceId, null, mangaUrl);
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

  reconcileChapterProgress(fromDetail.chapters, targetChapters, fromSourceId, targetSourceId, targetUrl);
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
