import { lib } from './library.js';
import { progress } from './progress.js';

const normalize = (value) => String(value || '').normalize('NFKC').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

function chapterNumber(chapter) {
  const direct = Number(chapter?.number ?? chapter?.chapterNumber);
  if (Number.isFinite(direct) && direct !== 0) return direct;
  for (const value of [chapter?.title, chapter?.name, chapter?.url]) {
    const match = String(value || '').match(/(?:chapter|cap[ií]tulo|cap\.?|ch\.?)\s*[-#:]?\s*(-?\d+(?:[.,]\d+)?)/i);
    if (!match) continue;
    const parsed = Number(match[1].replace(',', '.'));
    if (Number.isFinite(parsed) && parsed !== 0) return parsed;
  }
  return null;
}

function uniqueIndex(chapters, getKey) {
  const groups = new Map();
  chapters.forEach((chapter, index) => {
    const key = getKey(chapter);
    if (!key) return;
    const matches = groups.get(key) || [];
    matches.push(index);
    groups.set(key, matches);
  });
  return new Map([...groups].filter(([, matches]) => matches.length === 1).map(([key, [index]]) => [key, index]));
}

export function reconcileMihonProgress(mangaUrl, sourceId, chapters) {
  const favorite = lib.fav(mangaUrl, sourceId);
  const pending = Array.isArray(favorite?.mihonProgress) ? favorite.mihonProgress : [];
  if (!pending.length || !Array.isArray(chapters) || !chapters.length) return 0;

  const currentByUrl = uniqueIndex(chapters, (chapter) => chapter.url ? String(chapter.url) : '');
  const currentByName = uniqueIndex(chapters, (chapter) => normalize(chapter.title || chapter.name));
  const currentByNumber = uniqueIndex(chapters, (chapter) => {
    const number = chapterNumber(chapter);
    return number === null ? '' : String(number);
  });
  const pendingByName = uniqueIndex(pending, (chapter) => normalize(chapter.name));
  const pendingByNumber = uniqueIndex(pending, (chapter) => {
    const number = chapterNumber(chapter);
    return number === null ? '' : String(number);
  });
  const matchedIndexes = new Set();
  const remaining = [];

  pending.forEach((saved, pendingIndex) => {
    const savedNumber = chapterNumber(saved);
    const matchIndex = currentByUrl.get(saved.url)
      ?? (normalize(saved.name) ? currentByName.get(normalize(saved.name)) : undefined)
      ?? (savedNumber !== null && pendingByNumber.has(String(savedNumber)) ? currentByNumber.get(String(savedNumber)) : undefined)
      ?? (normalize(saved.name) && pendingByName.has(normalize(saved.name)) ? currentByName.get(normalize(saved.name)) : undefined);
    const chapter = matchIndex === undefined ? null : chapters[matchIndex];
    if (!chapter?.url) {
      remaining.push(saved);
      return;
    }

    matchedIndexes.add(pendingIndex);
    const existing = progress.get(chapter.url, sourceId);
    if (saved.read) {
      if (!existing?.read) progress.markRead(chapter.url, sourceId, existing?.total || 0);
    } else if (saved.page > 0 && !existing?.read) {
      const page = Math.max(Number(existing?.page) || 0, Number(saved.page) || 0);
      if (Number.isSafeInteger(page) && page > 0 && page !== existing?.page) {
        progress.savePage(chapter.url, sourceId, page, existing?.total || 0);
      }
    }
  });

  if (matchedIndexes.size) {
    lib.updateFav(mangaUrl, { mihonProgress: remaining.length ? remaining : undefined }, sourceId);
  }
  return matchedIndexes.size;
}
