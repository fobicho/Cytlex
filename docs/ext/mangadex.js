export default function createSource({ fetchText }) {
  const api = 'https://api.mangadex.org';
  const site = 'https://mangadex.org';
  const coverBase = 'https://uploads.mangadex.org/covers';
  const pageSize = 20;
  const chapterPageSize = 100;
  // es-la: MangaDex agrupa ahí el español latino; solo 'es' dejaba mangas sin capítulos
  const languages = ['es', 'es-la'];
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

  async function catalog({ q = '', page = 1 } = {}) {
    const data = await json(requestUrl('/manga', {
      title: q,
      limit: pageSize,
      offset: (Math.max(1, Number(page) || 1) - 1) * pageSize,
      'availableTranslatedLanguage[]': languages,
      'contentRating[]': ratings,
      'includes[]': ['cover_art'],
      'order[relevance]': 'desc'
    }));

    return {
      items: (data.data || []).map((item) => {
        const attributes = item.attributes || {};
        return {
          url: mangaUrl(item.id),
          title: localized(attributes.title),
          cover: coverUrl(item),
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
    const chapters = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await json(requestUrl('/chapter', {
        manga: id,
        limit: chapterPageSize,
        offset,
        'translatedLanguage[]': languages,
        'includes[]': ['scanlation_group'],
        'order[volume]': 'asc',
        'order[chapter]': 'asc'
      }));
      const records = (page.data || []).filter((chapter) => !chapter.attributes?.externalUrl);
      total = Number(page.total) || 0;
      chapters.push(...records.map((chapter) => {
        const a = chapter.attributes || {};
        const number = a.chapter ? `Capítulo ${a.chapter}` : a.volume ? `Volumen ${a.volume}` : '';
        const group = relationship(chapter, 'scanlation_group')?.attributes?.name || '';
        const label = [number || a.title || 'Capítulo sin título', a.title && number ? a.title : '', group]
          .filter(Boolean).join(' · ');
        return {
          url: chapterUrl(chapter, id, label),
          title: label,
          date: a.publishAt ? new Date(a.publishAt).toLocaleDateString('es') : ''
        };
      }));
      if (!records.length) break;
      offset += records.length;
    }

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
    const pages = (chapter.data || []).map((file) => `${data.baseUrl}/data/${chapter.hash}/${file}`);

    return {
      label,
      mangaUrl: mangaId ? mangaUrl(mangaId) : '',
      pages,
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'mangadex', name: 'MangaDex', catalog, detail, chapter };
}
