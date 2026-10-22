const ADULT_LABELS = new Set(['18+', '+18', 'r18+', 'adult', 'adulto', 'adulta', 'adultos', 'adultas', 'hentai', 'erotica', 'erotico', 'xxx', 'mature', 'explicit', 'nsfw']);

function hasAdultLabel(value) {
  const text = String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return text.split(/[^a-z0-9+]+/).some((part) => ADULT_LABELS.has(part));
}

export function isAdultManga(manga) {
  if (!manga || typeof manga !== 'object') return false;
  if (manga.isAdult === true || manga.adult === true) return true;
  if (hasAdultLabel(manga.ageRating) || hasAdultLabel(manga.contentRating) || hasAdultLabel(manga.rating)) return true;
  if (hasAdultLabel(manga.type) || hasAdultLabel(manga.facts?.tipo)) return true;
  return [...(Array.isArray(manga.genres) ? manga.genres : []), ...(Array.isArray(manga.tags) ? manga.tags : [])]
    .some((label) => hasAdultLabel(typeof label === 'string' ? label : label?.name));
}
