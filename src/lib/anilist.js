import { session } from './session.js';

const API = 'https://graphql.anilist.co';

const MEDIA_FIELDS = `
  id
  type
  siteUrl
  countryOfOrigin
  status
  format
  chapters
  volumes
  averageScore
  meanScore
  popularity
  favourites
  isAdult
  source
  startDate { year month day }
  endDate { year month day }
  genres
  synonyms
  title { romaji english native }
  coverImage { extraLarge large }
  description(asHtml: false)
  staff(perPage: 4) { edges { role node { name { full } } } }
`;

const cache = new Map();

const noBridge = () =>
  new Error('Sin puente Electron para consultar AniList. Abre la app con "npm run dev:electron".');

async function gql(query, variables = {}) {
  if (typeof window === 'undefined' || !window.cytlex?.httpPost) throw noBridge();
  const res = await window.cytlex.httpPost({ url: API, body: { query, variables } });
  if (res?.errors?.length) throw new Error(res.errors[0].message || 'Error de AniList');
  return res?.data;
}

// AniList devuelve HTML en la descripción, con notas del editor y la fuente
// entre paréntesis al final. Se descarta ese bloque y se queda solo el texto.
export function cleanDescription(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/<i{1,2}>\s*(Notes?|Nota)\s*:[\s\S]*?<\/i{1,2}>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\(\s*Source:[^)]*\)/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Los sinónimos de AniList vienen en todos los alfabetos y a veces no tienen
// nada que ver con la obra. Solo interesan los escritos en alfabeto latino.
const isLatinish = (s) => /^[\p{Script=Latin}\p{P}\p{Zs}0-9'’&.\-!?]+$/u.test(s);

const latinSynonyms = (list) => (list || []).filter((s) => s && isLatinish(s));

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fmtDate = (d) => {
  if (!d?.year) return '';
  if (!d.month) return String(d.year);
  if (!d.day) return `${MONTHS[d.month - 1]} ${d.year}`;
  return `${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
};

function normalize(media) {
  if (!media) return null;
  const titles = media.title || {};
  return {
    id: media.id,
    type: media.type,
    siteUrl: media.siteUrl,
    countryOfOrigin: media.countryOfOrigin,
    status: media.status,
    format: media.format,
    source: media.source,
    isAdult: !!media.isAdult,
    chapters: media.chapters ?? null,
    volumes: media.volumes ?? null,
    averageScore: media.averageScore ?? null,
    meanScore: media.meanScore ?? null,
    popularity: media.popularity ?? null,
    favourites: media.favourites ?? null,
    startDate: fmtDate(media.startDate),
    endDate: fmtDate(media.endDate),
    genres: media.genres || [],
    synonyms: latinSynonyms(media.synonyms),
    cover: media.coverImage?.extraLarge || media.coverImage?.large || '',
    title: titles.userPreferred || titles.romaji || titles.english || titles.native || '',
    romaji: titles.romaji || '',
    english: titles.english || '',
    native: titles.native || '',
    description: cleanDescription(media.description),
    author: mainAuthor(media.staff)
  };
}

// El primer rol de guion y/o dibujo es quien firma la obra.
const AUTHOR_ROLES = /story|art/i;

function mainAuthor(staff) {
  const edges = staff?.edges || [];
  const credited = edges.find((e) => AUTHOR_ROLES.test(e?.role || ''));
  return credited?.node?.name?.full || '';
}

const cached = (key, run) => {
  if (cache.has(key)) return cache.get(key);
  const promise = run().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, promise);
  return promise;
};

export const anilist = {
  async search(term, page = 1) {
    const q = String(term || '').trim();
    if (!q) return [];
    const key = `search|${q.toLowerCase()}|${page}`;
    return cached(key, async () => {
      const data = await gql(
        `query ($search: String, $page: Int) {
          Page(page: $page, perPage: 10) { media(search: $search, type: MANGA) { ${MEDIA_FIELDS} } }
        }`,
        { search: q, page }
      );
      return (data?.Page?.media || []).map(normalize);
    });
  },

  async byId(id) {
    if (!id) return null;
    return cached(`id|${id}`, async () => {
      const data = await gql(`query ($id: Int) { Media(id: $id, type: MANGA) { ${MEDIA_FIELDS} } }`, { id });
      return normalize(data?.Media);
    });
  },

  clearCache() {
    cache.clear();
  }
};

const ENTRY_FIELDS = `
  id
  status
  progress
  progressVolumes
  score(format: POINT_100)
  repeat
  notes
  updatedAt
  startedAt { year month day }
  completedAt { year month day }
  media { id title { romaji english } coverImage { large } }
`;

// Al leer, AniList guarda la puntuación en 0-100 y `score(format:)` sí
// convierte. Se pide el valor nativo y se pasa a la escala de la cuenta.
// Al escribir ocurre lo contrario: `score` espera el valor ya en la escala del
// usuario, así que se envía sin convertir.
const toUserScale = (raw) => {
  if (raw == null) return null;
  if (SCORE_SCALE === 'POINT_100') return raw;
  if (SCORE_SCALE === 'POINT_10' || SCORE_SCALE === 'POINT_10_DECIMAL') return Math.round(raw) / 10;
  if (SCORE_SCALE === 'POINT_5') return Math.round(raw / 20);
  if (SCORE_SCALE === 'POINT_3') return Math.round((raw / 100) * 3);
  return raw;
};

let SCORE_SCALE = 'POINT_10_DECIMAL';

export function setScoreScale(format) {
  if (format) SCORE_SCALE = format;
}

function normalizeEntry(e) {
  if (!e) return null;
  const t = e.media?.title || {};
  return {
    entryId: e.id,
    mediaId: e.media?.id,
    title: t.romaji || t.english || '',
    cover: e.media?.coverImage?.large || '',
    status: e.status,
    progress: e.progress ?? 0,
    progressVolumes: e.progressVolumes ?? null,
    score: toUserScale(e.score) ?? null,
    repeat: e.repeat ?? null,
    notes: e.notes || '',
    updatedAt: e.updatedAt || 0,
    startedAt: fmtDate(e.startedAt),
    completedAt: fmtDate(e.completedAt)
  };
}

export const anilistList = {
  async myList() {
    const viewer = await session.viewer();
    if (!viewer) return [];
    return cached(`mylist|${viewer.id}`, async () => {
      const data = await session.gql(
        `query ($userId: Int) {
          MediaListCollection(userId: $userId, type: MANGA) {
            lists {
              entries {
                ${ENTRY_FIELDS}
              }
            }
          }
        }`,
        { userId: viewer.id }
      );
      const lists = data?.MediaListCollection?.lists || [];
      return lists
        .flatMap((l) => l.entries || [])
        .map(normalizeEntry)
        .filter(Boolean);
    });
  },

  async entry(mediaId) {
    if (!mediaId) return null;
    return cached(`entry|${mediaId}`, async () => {
      // mediaListEntry pertenece al viewer autenticado: no admite userId.
      const data = await session.gql(
        `query ($mediaId: Int) {
          Media(id: $mediaId, type: MANGA) { mediaListEntry { ${ENTRY_FIELDS} } }
        }`,
        { mediaId }
      );
      return normalizeEntry(data?.Media?.mediaListEntry);
    });
  },

  async saveEntry(patch) {
    if (!patch?.mediaId) throw new Error('Falta el id de la obra');
    const variables = { mediaId: patch.mediaId };
    if (patch.entryId) variables.id = patch.entryId;
    if (patch.status) variables.status = patch.status;
    if (patch.progress != null) variables.progress = patch.progress;
    if (patch.progressVolumes != null) variables.progressVolumes = patch.progressVolumes;
    // `score` es Float y espera el valor ya en la escala de la cuenta.
    if (patch.score != null) variables.score = Number(patch.score);
    if (patch.startedAt !== undefined) variables.startedAt = fuzzyDate(patch.startedAt);
    if (patch.completedAt !== undefined) variables.completedAt = fuzzyDate(patch.completedAt);

    const data = await session.gql(
      `mutation ($id: Int, $mediaId: Int, $status: MediaListStatus, $progress: Int, $progressVolumes: Int, $score: Float, $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry(
          id: $id, mediaId: $mediaId, status: $status, progress: $progress,
          progressVolumes: $progressVolumes, score: $score,
          startedAt: $startedAt, completedAt: $completedAt
        ) { ${ENTRY_FIELDS} }
      }`,
      variables
    );
    const viewer = await session.viewer();
    cache.delete(`entry|${patch.mediaId}`);
    if (viewer) cache.delete(`mylist|${viewer.id}`);
    return normalizeEntry(data?.SaveMediaListEntry);
  }
};

const MONTH_NUM = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };

// Acepta ISO ("2025-08-20"), el formato de AniList ("20 ago 2025") y año suelto.
function fuzzyDate(str) {
  if (!str) return { year: null, month: null, day: null };
  const s = String(str).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3] };
  const d = s.match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/i);
  if (d) {
    const mon = MONTH_NUM[d[2].toLowerCase()];
    return { year: +d[3], month: mon || null, day: +d[1] };
  }
  const m = s.match(/^(\d{4})(?:[/-](\d{1,2}))?(?:[/-](\d{1,2}))?$/);
  if (m) return { year: +m[1], month: m[2] ? +m[2] : null, day: m[3] ? +m[3] : null };
  return { year: null, month: null, day: null };
}
