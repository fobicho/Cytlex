export default function createSource({ fetchText }) {
  const base = 'https://olympusxyz.com';
  const LIMIT_PAGES = 200;

  const getJson = async (url, requestId) => JSON.parse(await fetchText(url, requestId));
  const isComic = (s) => (s.type || 'comic').toLowerCase() === 'comic';
  let seriesListRequest;
  let latestChapters;
  const chapterListRequests = new Map();

  const best = (u) => (u || '').replace(/-[a-z]{1,3}\.(jpe?g|png|webp|avif)$/i, '-xl.$1');

  const toItem = (s) => ({
    url: `${base}/series/${s.slug}`,
    title: s.name || '',
    cover: best(s.cover),
    author: [s.author, s.artist]
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => typeof value === 'string' ? value : value?.name || '')
      .filter(Boolean)
      .join(', '),
    type: s.type || 'comic'
  });

  const comicsOf = (data) => {
    const list = data?.data || [];
    const comics = list.filter(isComic);
    return comics.length ? comics : list;
  };

  async function catalog({ q = '', page = 1, __cytlexRequestId } = {}) {
    if (q) {
      seriesListRequest ||= getJson(`${base}/api/series/list`, __cytlexRequestId).catch((error) => {
        seriesListRequest = null;
        throw error;
      });
      const data = await seriesListRequest;
      const items = comicsOf(data)
        .filter((s) => (s.name || '').toLowerCase().includes(q.toLowerCase()))
        .map(toItem);
      return { items, totalPages: 1, totalText: '' };
    }

    const data = await getJson(`${base}/api/rankings?page=${page}&period=total_ranking`, __cytlexRequestId);
    const items = comicsOf(data).map(toItem);
    const last = data?.last_page || data?.meta?.last_page || 0;
    const totalPages = last || (data?.next_page_url ? page + 1 : page);
    return { items, totalPages, totalText: '' };
  }

  async function fetchChapterList(slug) {
    const chaptersFetch = (page) =>
      getJson(`${base}/api/series/${slug}/chapters?page=${page}&direction=desc&type=comic`);
    const first = await chaptersFetch(1);
    const lastPage = Math.min(first?.meta?.last_page || 1, LIMIT_PAGES);
    const rest = [];
    for (let start = 2; start <= lastPage; start += 6) {
      const count = Math.min(6, lastPage - start + 1);
      const batch = await Promise.all(Array.from({ length: count }, (_, i) => chaptersFetch(start + i)));
      rest.push(...batch);
    }
    return [first, ...rest].flatMap((res) => res?.data || []);
  }

  function listChapters(slug) {
    if (!chapterListRequests.has(slug)) {
      chapterListRequests.set(slug, fetchChapterList(slug).then((entries) => {
        latestChapters = { slug, entries };
        return entries;
      }).finally(() => chapterListRequests.delete(slug)));
    }
    return chapterListRequests.get(slug);
  }

  async function detail(mangaUrl) {
    const slug = String(mangaUrl).split('/').filter(Boolean).pop();
    const [data, entries] = await Promise.all([
      getJson(`${base}/api/series/${slug}?type=comic`),
      listChapters(slug)
    ]);
    const s = data?.data || {};
    const chapters = entries.map((c) => ({
      url: `${base}/capitulo/${slug}/${c.id}`,
      title: c.name ? `Capítulo ${c.name}` : `Capítulo ${c.id}`,
      date: c.published_at || ''
    }));

    const status = s.status?.name || '';
    return {
      title: s.name || '',
      cover: best(s.cover),
      altTitles: '',
      genres: [...(s.genres || [])].map((g) => g.name).filter(Boolean),
      facts: { estado: status, status, tipo: s.type || '', autor: s.team?.name || '', vistas: '' },
      sinopsis: (s.summary || '').trim(),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const [, slug, id] = new URL(chapterUrl).pathname.split('/').filter(Boolean);
    const matchesId = (entry) => String(entry.id) === id;
    const cached = latestChapters?.slug === slug && latestChapters.entries.find(matchesId);
    const entry = cached || (await listChapters(slug)).find(matchesId);
    const number = String(entry?.name ?? '').trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(number)) {
      throw new Error('Olympus no encontró el número de este capítulo en la serie.');
    }
    const data = await getJson(`${base}/api/capitulo/${slug}/${number}`);
    const ch = data?.chapter || {};
    return {
      label: ch.name ? `Capítulo ${ch.name}` : '',
      mangaUrl: `${base}/series/${slug}`,
      pages: (ch.pages || []).filter(Boolean),
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'olympusscanlation', name: 'Olympus Scanlation', catalog, detail, chapter };
}
