import { chapterIndex } from './chapterIndex.js';
import { extensions } from './extensions.js';
import { importMihonBackup } from './mihonBackup.js';
import { reconcileMihonProgress } from './mihonProgress.js';

let queue = null;

export function startMihonMigration(entries) {
  const id = crypto.randomUUID?.() || String(Date.now());
  queue = { id, entries, index: 0, migrated: 0 };
  return `/explorar?tab=mangas&mihonMigration=${id}`;
}

export function getMihonMigration(id) {
  return queue?.id === id ? queue : null;
}

export function finishMihonMigration(id) {
  if (queue?.id === id) queue = null;
}

export function saveMihonMigration(entry, targetUrl, targetSourceId, detail) {
  const manifest = extensions.manifest(targetSourceId);
  const chapters = detail.chapters || [];
  const manga = {
    ...entry.manga,
    url: targetUrl,
    sourceId: targetSourceId,
    sourceName: manifest.name,
    sourceIcon: manifest.icon || '',
    title: detail.title || entry.manga.title,
    cover: detail.cover || '',
    author: detail.facts?.autor || entry.manga.author,
    type: detail.facts?.tipo || entry.manga.type,
    genres: detail.genres || entry.manga.genres,
    chapterTotal: chapters.length,
    chapterReadCount: 0
  };
  importMihonBackup({
    categoryNames: [],
    entries: [{ manga, chapterProgress: entry.chapterProgress }]
  }, { matchByWork: false });
  reconcileMihonProgress(targetUrl, targetSourceId, chapters);
  chapterIndex.set(targetUrl, targetSourceId, chapters.map(({ url }) => url).filter(Boolean));
}
