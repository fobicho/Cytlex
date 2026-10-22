function normalize(value) {
  return String(value || '').toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function isAdultFlag(value) {
  return value === true || value === 1 || /^(?:true|1|yes|si)$/i.test(String(value || '').trim());
}

const ADULT_LABELS = new Set([
  '+18', '18+', 'r18', 'r-18', 'adult', 'adulto', 'adulta', 'adult content', 'contenido adulto', 'contenido para adultos',
  'hentai', 'smut', 'erotica', 'erotico', 'erotica para adultos', 'porn', 'porno', 'pornografico', 'pornografia',
  'nsfw', 'explicit', 'explicit content'
]);

function isAdultMetadata(value) {
  if (Array.isArray(value)) return value.some(isAdultMetadata);
  if (value && typeof value === 'object') {
    return isAdultMetadata(value.name ?? value.label ?? value.value ?? '');
  }

  const text = normalize(value).replace(/[_]+/g, ' ');
  if (ADULT_LABELS.has(text)) return true;
  if (/(?:^|[^a-z0-9])(?:\+\s*18|18\s*\+|r\s*[- ]?\s*18\s*\+?)(?=$|[^a-z0-9])/i.test(text)) return true;
  return text.split(/[,;|\/·\n]+/).some((label) => ADULT_LABELS.has(label.trim()));
}

const ADULT_FLAG_KEYS = ['isAdult', 'is_adult', 'is_adulto', 'isAdultContent', 'adult', 'adulto', 'adultContent', 'adult_content', 'contenido_adulto', 'is_nsfw', 'nsfw'];
const RATING_KEYS = ['ageRating', 'age_rating', 'contentRating', 'content_rating', 'classification', 'clasificacion', 'clasificacion_edad', 'rating', 'contentWarning', 'content_warning'];

export function isAdultManga(manga) {
  if (!manga || typeof manga !== 'object') return false;

  if (manga.adultClassification === 'adult') return true;

  const isSavedRecord = manga.savedAt != null || Array.isArray(manga.cats);
  if (ADULT_FLAG_KEYS.some((key) => {
    if (key === 'adult' && isSavedRecord) return false;
    return isAdultFlag(manga[key]) || isAdultMetadata(manga[key]);
  })) return true;

  if (RATING_KEYS.some((key) => isAdultMetadata(manga[key]))) return true;

  const asValues = (value) => Array.isArray(value) ? value : value == null ? [] : [value];
  return [manga.genres, manga.tags, manga.contentWarnings, manga.content_warnings]
    .some((values) => asValues(values).some(isAdultMetadata));
}
