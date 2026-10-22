const ADULT_RATING = /(?:^|[^a-z0-9])(?:\+\s*18|18\s*\+|r\s*[- ]?\s*18\s*\+?|adult(?:o|a|os|as)?(?:\s+content)?|sex(?:ual(?:\s+content)?|ually\s+explicit|less)?|hentai|smut|erotica|erotic|porn(?:o|graphic|ography)?|xxx|nsfw|explicit|foll(?:ar|ando|ado|a|as|an))(?=$|[^a-z0-9])/i;
const ADULTS_ONLY_RATING = /(?:^|[^a-z0-9])adults?\s+only(?=$|[^a-z0-9])/i;

function normalize(value) {
  return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isAdultFlag(value) {
  return value === true || value === 1 || /^(?:true|1|yes|si)$/i.test(String(value || '').trim());
}

function containsAdultRating(value, { allowAdultOnly = false } = {}) {
  if (Array.isArray(value)) return value.some((item) => containsAdultRating(item, { allowAdultOnly }));
  if (value && typeof value === 'object') {
    return containsAdultRating(value.name ?? value.label ?? value.value ?? '', { allowAdultOnly });
  }
  const text = normalize(value);
  return ADULT_RATING.test(text) || (allowAdultOnly && ADULTS_ONLY_RATING.test(text));
}

const ADULT_FLAG_KEYS = ['isAdult', 'is_adult', 'is_adulto', 'isAdultContent', 'adult', 'adulto', 'adultContent', 'adult_content', 'contenido_adulto', 'is_nsfw', 'nsfw'];
const RATING_KEYS = ['ageRating', 'age_rating', 'contentRating', 'content_rating', 'classification', 'clasificacion', 'clasificacion_edad', 'rating', 'contentWarning', 'content_warning'];

export function isAdultManga(manga) {
  if (!manga || typeof manga !== 'object') return false;

  if (manga.adultClassification === 'adult') return true;
  if (containsAdultRating(manga.title)) return true;

  const isSavedRecord = manga.savedAt != null || Array.isArray(manga.cats);
  if (ADULT_FLAG_KEYS.some((key) => {
    if (key === 'adult' && isSavedRecord) return false;
    return isAdultFlag(manga[key]) || containsAdultRating(manga[key]);
  })) return true;

  if (RATING_KEYS.some((key) => containsAdultRating(manga[key], { allowAdultOnly: true }))) return true;

  const adultGenreOrTag = (value) => containsAdultRating(value);
  const asValues = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  return [manga.genres, manga.tags, manga.contentWarnings, manga.content_warnings]
    .some((values) => asValues(values).some(adultGenreOrTag));
}
