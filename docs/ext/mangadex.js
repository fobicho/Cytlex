export default function createSource({ fetchText, id: baseId, config, languageSelections }) {
  const api = 'https://api.mangadex.org';
  const site = 'https://mangadex.org';
  const coverBase = 'https://uploads.mangadex.org/covers';
  const pageSize = 20;
  const chapterPageSize = 100;
  const ratings = ['safe', 'suggestive', 'erotica', 'pornographic'];
  const types = { ja: 'Manga', ko: 'Manhwa', zh: 'Manhua', 'zh-hk': 'Manhua' };
  let requestQueue = Promise.resolve();
  let lastRequestAt = 0;

  const json = (url) => {
    const request = async () => {
      const wait = Math.max(0, 300 - (Date.now() - lastRequestAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      let response;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        lastRequestAt = Date.now();
        try {
          response = await fetchText(url);
          break;
        } catch (error) {
          if (attempt || /HTTP \d{3}/.test(String(error?.message || error))) throw error;
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      }
      const data = JSON.parse(response);
      if (data?.result !== 'ok') throw new Error('MangaDex devolvió una respuesta no válida.');
      return data;
    };
    const pending = requestQueue.then(request);
    requestQueue = pending.catch(() => {});
    return pending;
  };

  const requestUrl = (path, params) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === '') continue;
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item));
    }
    return `${api}${path}?${query}`;
  };

  const relationship = (item, type) => item?.relationships?.find((rel) => rel.type === type);
  const coverUrl = (item, size = '256.jpg') => {
    const cover = relationship(item, 'cover_art')?.attributes?.fileName;
    return cover ? `${coverBase}/${item.id}/${cover}.${size}` : '';
  };
  const localized = (map = {}) => map.es || map.en || map['ja-ro'] || map.ja || Object.values(map)[0] || '';
  const mangaUrl = (id) => `${site}/title/${id}`;
  const chapterUrl = (chapter, mangaId, label) => {
    const params = new URLSearchParams({ manga: mangaId, label });
    return `${site}/chapter/${chapter.id}?${params}`;
  };

  const makeSource = (sourceId, sourceConfig) => {
    const defaultLanguages = Array.isArray(sourceConfig?.default) && sourceConfig.default.length
      ? sourceConfig.default
      : (sourceConfig?.languages || []).map((l) => l.code);

    const getLanguages = () => {
      const selected = languageSelections?.[sourceId]?.languages;
      if (Array.isArray(selected) && selected.length) return selected;
      return defaultLanguages.length ? defaultLanguages : ['es', 'es-la'];
    };

    async function catalog({ q = '', page = 1 } = {}) {
      const data = await json(requestUrl('/manga', {
        title: q,
        limit: pageSize,
        offset: (Math.max(1, Number(page) || 1) - 1) * pageSize,
        'availableTranslatedLanguage[]': getLanguages(),
        'contentRating[]': ratings,
        'includes[]': ['cover_art', 'author', 'artist'],
        'order[relevance]': 'desc'
      }));

      return {
        items: (data.data || []).map((item) => {
          const attributes = item.attributes || {};
          const authors = (item.relationships || [])
            .filter((rel) => rel.type === 'author' || rel.type === 'artist')
            .map((rel) => rel.attributes?.name)
            .filter(Boolean);
          return {
            url: mangaUrl(item.id),
            title: localized(attributes.title),
            cover: coverUrl(item),
            author: [...new Set(authors)].join(', '),
            type: types[attributes.originalLanguage] || 'Manga',
            lastChapter: ''
          };
        }).filter((item) => item.title && item.url),
        totalPages: Math.max(1, Math.ceil((Number(data.total) || 0) / pageSize)),
        totalText: String(data.total || 0)
      };
    }

    async function detail(url) {
      const id = new URL(url, site).pathname.split('/').filter(Boolean).at(-1);
      if (!id) throw new Error('No se pudo identificar el manga de MangaDex.');

      const data = await json(requestUrl(`/manga/${id}`, {
        'includes[]': ['cover_art', 'author', 'artist']
      }));
      const item = data.data;
      const attributes = item?.attributes || {};

      const fetchChapters = async (mangaId) => {
        const entries = [];
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
          const page = await json(requestUrl('/chapter', {
            manga: mangaId,
            limit: chapterPageSize,
            offset,
            'translatedLanguage[]': getLanguages(),
            'contentRating[]': ratings,
            'includes[]': ['scanlation_group'],
            'order[volume]': 'asc',
            'order[chapter]': 'asc'
          }));
          const pageData = Array.isArray(page.data) ? page.data : [];
          const records = pageData.filter((chapter) => !chapter.attributes?.externalUrl);
          total = Number(page.total) || 0;
          entries.push(...records.map((chapter) => {
            const a = chapter.attributes || {};
            return {
              a,
              chapterId: chapter.id,
              group: relationship(chapter, 'scanlation_group')?.attributes?.name || '',
              number: a.chapter != null && a.chapter !== '' ? parseFloat(a.chapter) : NaN,
              publishAt: a.publishAt || ''
            };
          }));
          if (!pageData.length) break;
          offset += pageData.length;
        }

        const locale = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
        entries.sort((a, b) => (Number.isNaN(a.number) ? 1 : Number.isNaN(b.number) ? -1 : a.number - b.number)
          || locale(a.a.chapter, b.a.chapter)
          || locale(a.publishAt, b.publishAt)
          || locale(a.a.volume, b.a.volume));

        return entries.map((e) => {
          const a = e.a;
          const number = a.chapter ? `Capítulo ${a.chapter}` : a.volume ? `Volumen ${a.volume}` : '';
          const label = [number || a.title || 'Capítulo sin título', a.title && number ? a.title : '']
            .filter(Boolean).join(' · ');
          return {
            url: chapterUrl({ id: e.chapterId }, mangaId, label),
            title: label,
            group: e.group,
            date: a.publishAt ? new Date(a.publishAt).toLocaleDateString('es') : ''
          };
        });
      };

      const chapters = await fetchChapters(id);

      const authors = (item?.relationships || [])
        .filter((rel) => rel.type === 'author' || rel.type === 'artist')
        .map((rel) => rel.attributes?.name)
        .filter(Boolean);
      const genres = (attributes.tags || [])
        .filter((tag) => tag.attributes?.group === 'genre')
        .map((tag) => localized(tag.attributes?.name))
        .filter(Boolean);
      const synopsis = attributes.description || {};
      const description = localized(synopsis);
      const statuses = { ongoing: 'En curso', completed: 'Finalizado', hiatus: 'En pausa', cancelled: 'Cancelado' };
      const status = statuses[attributes.status] || attributes.status || '';

      return {
        title: localized(attributes.title),
        cover: coverUrl(item, '512.jpg'),
        altTitles: (attributes.altTitles || []).map(localized).filter(Boolean).join(' · '),
        genres,
        facts: {
          estado: status,
          status,
          tipo: types[attributes.originalLanguage] || 'Manga',
          autor: [...new Set(authors)].join(', '),
          vistas: ''
        },
        sinopsis: description,
        chapters
      };
    }

    async function chapter(url) {
      const parsed = new URL(url, site);
      const id = parsed.pathname.split('/').filter(Boolean).at(-1);
      if (!id) throw new Error('No se pudo identificar el capítulo de MangaDex.');
      const mangaId = parsed.searchParams.get('manga') || '';
      const label = parsed.searchParams.get('label') || 'Capítulo';
      const data = await json(`${api}/at-home/server/${id}`);
      const chapter = data.chapter || {};
      const pages = (chapter.data || []).map((file) => `https://uploads.mangadex.org/data/${chapter.hash}/${file}`);

      return {
        label,
        mangaUrl: mangaId ? mangaUrl(mangaId) : '',
        pages,
        options: [],
        prev: null,
        next: null
      };
    }

    return { id: sourceId, name: sourceConfig?.name || 'MangaDex', catalog, detail, chapter };
  };

  if (Array.isArray(config?.sources) && config.sources.length) {
    const sources = {};
    for (const sub of config.sources) sources[sub.id] = makeSource(sub.id, sub);
    return sources;
  }
  return makeSource(baseId || 'mangadex', config);
}
