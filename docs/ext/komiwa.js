export default function createSource({ fetchText, fetchPostText, parse }) {
  const site = 'https://www.komiwa.net';
  const api = 'https://b78sk.komiwa.net';
  const pageSize = 30;
  const chapterLimit = 99999;
  const mangaCache = new Map();
  const chapterCache = new Map();

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const slugFromUrl = (url) => new URL(url, site).pathname.split('/').filter(Boolean).at(-1) || '';
  const abs = (value, base = site) => {
    try { return new URL(value, base).href; } catch { return ''; }
  };

  async function json(path, body, requestId) {
    const raw = await fetchPostText({
      url: `${api}${path}`,
      body: JSON.stringify(body),
      headers: { Accept: 'application/json' }
    }, requestId);
    const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!result?.success || !result.data) throw new Error('Komiwa devolvió una respuesta no válida.');
    return result.data;
  }

  async function getJson(path, requestId) {
    const raw = await fetchText(`${api}${path}`, requestId);
    const result = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!result?.success || !result.data) throw new Error('Komiwa devolvió una respuesta no válida.');
    return result.data;
  }

  const rememberManga = (item) => {
    if (!item?.id || !item.slug) return;
    mangaCache.set(item.slug, item);
    if (mangaCache.size > 80) mangaCache.delete(mangaCache.keys().next().value);
  };

  function mangaResult(item) {
    rememberManga(item);
    return {
      url: `${site}/manga/${encodeURIComponent(item.slug)}`,
      title: clean(item.title),
      cover: abs(item.cover),
      author: '',
      type: clean(item.type?.name).replace(/^./, (char) => char.toUpperCase()) || 'Manga',
      lastChapter: clean(item.lastChapter || item.chapters?.[0]?.number)
    };
  }

  async function catalog({ q = '', page = 1, sort = '', __cytlexRequestId } = {}) {
    const currentPage = Math.max(1, Number(page) || 1);
    const query = clean(q);
    const recentFeed = !query && !['rating', 'title', 'views'].includes(sort);
    const data = query
      ? await json('/manga/search', { q: query, limit: pageSize, ...(currentPage > 1 ? { page: currentPage } : {}) }, __cytlexRequestId)
      : recentFeed
        ? await getJson(`/manga/recent-chapters?page=${currentPage}&limit=${pageSize}`, __cytlexRequestId)
        : await json('/manga/catalog', {
        sortBy: sort === 'rating' ? 'rating' : sort === 'title' ? 'title' : sort === 'views' ? 'views' : 'lastUpdateAt',
        sortOrder: sort === 'title' ? 'asc' : 'desc',
        limit: pageSize,
        ...(currentPage > 1 ? { page: currentPage } : {})
      }, __cytlexRequestId);
    const items = [...new Map((data.items || [])
      .map((item) => mangaResult(item.manga ? { ...item.manga, lastChapter: item.number } : item))
      .filter((item) => item.title && item.url)
      .map((item) => [item.url, item])).values()];
    const total = Number(data.total) || 0;
    return {
      items,
      totalPages: data.hasMore ? currentPage + 1 : Math.max(1, currentPage),
      totalText: total && !recentFeed ? String(total) : ''
    };
  }

  async function detail(url) {
    const slug = slugFromUrl(url);
    if (!slug) throw new Error('No se pudo identificar el manga de Komiwa.');
    let manga = mangaCache.get(slug);
    if (!manga) {
      const data = await json('/manga/search', { q: slug.replace(/-/g, ' '), limit: pageSize });
      manga = (data.items || []).find((item) => item.slug === slug);
    }
    if (!manga?.id) throw new Error('No se encontraron los datos del manga en Komiwa.');
    rememberManga(manga);

    const chaptersData = await fetchText(`${api}/manga/${encodeURIComponent(manga.id)}/chapters?page=1&limit=${chapterLimit}&sort=desc`);
    const chapterResponse = JSON.parse(chaptersData);
    const listed = chapterResponse?.data?.chapters || [];
    const mangaTitle = clean(manga.title).toLocaleLowerCase('es');
    const chapters = listed
      .filter((item) => item?.id)
      .sort((a, b) => {
        const aNumber = Number.parseFloat(a.number);
        const bNumber = Number.parseFloat(b.number);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) return aNumber - bNumber;
        return String(a.number).localeCompare(String(b.number), 'es', { numeric: true });
      })
      .map((item) => {
        const title = clean(item.title);
        return {
          title: !title || title.toLocaleLowerCase('es') === mangaTitle
            ? `Capítulo ${clean(item.number)}`
            : title,
          url: `${site}/chapter/${encodeURIComponent(item.id)}?manga=${encodeURIComponent(manga.id)}&slug=${encodeURIComponent(slug)}`,
          date: clean(item.publishedAt || item.createdAt),
          group: clean(typeof item.group === 'string' ? item.group : item.group?.name)
        };
      });
    const chapterOptions = chapters.map(({ title, url: chapterUrl }) => ({ title, url: chapterUrl }));
    for (const item of listed) chapterCache.set(item.id, { manga, chapterOptions });

    const html = await fetchText(`${site}/manga/${encodeURIComponent(slug)}`);
    const doc = parse(html);
    const structured = [...doc.querySelectorAll('script[type="application/ld+json"]')]
      .map((node) => {
        try { return JSON.parse(node.textContent || ''); } catch { return null; }
      })
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .find((value) => value?.['@type'] === 'ComicSeries') || {};
    const author = Array.isArray(structured.author)
      ? structured.author.map((person) => person?.name).filter(Boolean).join(', ')
      : clean(structured.author?.name || structured.author);
    const genres = Array.isArray(structured.genre)
      ? structured.genre.map(clean).filter(Boolean)
      : clean(structured.genre).split(',').map(clean).filter(Boolean);

    return {
      title: clean(manga.title || structured.name),
      cover: abs(manga.cover || structured.image),
      altTitles: Array.isArray(structured.alternateName) ? structured.alternateName.join(', ') : clean(structured.alternateName),
      genres,
      facts: {
        estado: clean(manga.status?.name),
        status: clean(manga.status?.name),
        tipo: clean(manga.type?.name).replace(/^./, (char) => char.toUpperCase()) || 'Manga',
        demografía: clean(manga.demography?.name),
        autor: author,
        capítulos: String(manga.numChapters ?? structured.numberOfIssues ?? chapters.length),
        valoración: manga.ratingAvg ? String(manga.ratingAvg) : '',
        vistas: manga.views ? String(manga.views) : '',
        año: manga.year ? String(manga.year) : ''
      },
      sinopsis: clean(structured.description || manga.synopsis),
      chapters
    };
  }

  async function chapter(url) {
    const parsed = new URL(url, site);
    const chapterId = parsed.pathname.split('/').filter(Boolean).at(-1);
    const cached = chapterCache.get(chapterId);
    const mangaId = parsed.searchParams.get('manga') || cached?.manga?.id;
    const slug = parsed.searchParams.get('slug') || cached?.manga?.slug;
    if (!chapterId || !mangaId) throw new Error('No se pudo identificar el manga y capítulo de Komiwa. Abre primero su ficha.');

    const referer = `${site}/chapter/${encodeURIComponent(chapterId)}`;
    const html = await fetchText(referer, undefined, { headers: { Referer: `${site}/` } });
    const doc = parse(html);
    const pages = [...doc.querySelectorAll('img[src], img[data-src], img[data-lazy-src], img[data-original]')]
      .map((image) => abs(image.getAttribute('data-src') || image.getAttribute('data-lazy-src')
        || image.getAttribute('data-original') || image.getAttribute('src'), referer))
      .filter((src) => {
        if (!src) return false;
        const host = new URL(src).hostname.toLowerCase();
        return host === 'media.mangavault.lat' || host === 'images.komiwa.net'
          || host === 'cdnlxd.xyz' || host.endsWith('.cdnlxd.xyz');
      })
      .filter((src, index, list) => list.indexOf(src) === index);
    if (!pages.length) throw new Error('Komiwa no entregó páginas legibles para este capítulo.');

    const index = cached?.chapterOptions?.findIndex((item) => new URL(item.url).pathname.endsWith(`/${chapterId}`)) ?? -1;
    const current = cached?.chapterOptions?.[index];
    return {
      label: current?.title || clean(doc.querySelector('h1')?.textContent) || 'Capítulo',
      mangaUrl: `${site}/manga/${encodeURIComponent(slug || '')}`,
      imageReferer: referer,
      pages,
      options: cached?.chapterOptions || [],
      prev: index > 0 ? cached.chapterOptions[index - 1] : null,
      next: index >= 0 && index + 1 < cached.chapterOptions.length ? cached.chapterOptions[index + 1] : null
    };
  }

  return { id: 'komiwa', name: 'Komiwa', catalog, detail, chapter };
}
