const BASE = 'https://inmanga.com';
const CHAPTERS = `${BASE}/chapter/getall`;
const PAGE_LIST = `${BASE}/chapter/chapterIndexControls`;
const PAGES = 'https://pack-yak.intomanga.com/images/manga/ms/chapter/ch/page/p';
const PAGE_SIZE = 10;

export default function createSource({ fetchText, fetchPostText, parse }) {
  const chapterCache = new Map();

  const abs = (value) => {
    if (!value) return '';
    try { return new URL(value, BASE).href; } catch { return ''; }
  };

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const text = (element, selector) => clean(element.querySelector(selector)?.textContent);
  const coverFrom = (doc) => {
    const metaCover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (metaCover) return abs(metaCover);
    const selectors = [
      '.manga-cover img',
      'img[class*="cover" i]',
      'img[id*="cover" i]',
      'img[src*="/i/m/" i]',
      'img[data-src*="/i/m/" i]',
      'img[data-original*="/i/m/" i]',
      'img[src*="/images/manga/" i]',
      'img[data-src*="/images/manga/" i]',
      'img[data-original*="/images/manga/" i]'
    ];
    for (const selector of selectors) {
      const image = doc.querySelector(selector);
      if (!image) continue;
      const source = image.getAttribute('data-src')
        || image.getAttribute('data-original')
        || image.getAttribute('data-lazy-src')
        || image.getAttribute('src');
      if (source && !/^data:image\/(?:gif|svg\+xml)/i.test(source)) return abs(source);
    }
    return '';
  };
  const mangaData = (url) => {
    const parsed = new URL(url, BASE);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const uuid = parts.at(-1) || '';
    return { url: parsed.href, slug: parts.at(-2) || '', id: uuid };
  };
  const chapterUrl = (manga, item) => {
    const params = new URLSearchParams({
      identification: item.identification,
      mangaIdentification: manga.id,
      slug: manga.slug,
      number: String(item.number)
    });
    return `${PAGE_LIST}?${params}`;
  };

  async function chapterList(mangaId) {
    const data = JSON.parse(await fetchText(`${CHAPTERS}?mangaIdentification=${encodeURIComponent(mangaId)}`));
    let payload = data?.data ?? data;
    if (typeof payload === 'string') payload = JSON.parse(payload);
    const chapters = payload?.result || payload?.Result || [];
    return chapters.map((item) => ({
      ...item,
      identification: item.identification ?? item.Identification,
      number: item.number ?? item.Number,
      date: item.date ?? item.Date ?? item.publishDate ?? item.PublishDate
    })).filter((item) => item.identification != null);
  }

  async function catalog({ q = '', page = 1 } = {}) {
    const query = clean(q);
    if (!query) return { items: [], totalPages: 1, hasMore: false, totalText: '' };
    const skip = (Math.max(1, Number(page) || 1) - 1) * PAGE_SIZE;
    const form = new URLSearchParams();
    form.set('hfilter[generes][]', '-1');
    form.set('filter[queryString]', query);
    form.set('filter[skip]', String(skip));
    form.set('filter[take]', String(PAGE_SIZE));
    form.set('filter[sortby]', '1');
    form.set('filter[broadcastStatus]', '0');
    form.set('filter[onlyFavorites]', 'false');
    const searchUrl = `${BASE}/manga/getMangasConsultResult`;
    const html = await fetchPostText({
      url: searchUrl,
      body: form.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: '*/*',
        Origin: BASE,
        Referer: `${BASE}/manga/consult?suggestion=${encodeURIComponent(query)}`,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const doc = parse(html);
    const seen = new Set();
    const items = [...doc.querySelectorAll('a[href*="/ver/manga/"]')].map((anchor) => {
      const url = abs(anchor.getAttribute('href'));
      const card = anchor.closest('article, li') || anchor;
      const image = anchor.querySelector('img') || card.querySelector('img');
      return {
        url,
        title: text(anchor, 'h4, h3, .title') || clean(anchor.getAttribute('title')) || clean(image?.getAttribute('alt')) || clean(anchor.textContent),
        cover: abs(image?.getAttribute('data-src') || image?.getAttribute('data-original') || image?.getAttribute('data-lazy-src') || image?.getAttribute('src')),
        type: 'Manga',
        lastChapter: text(anchor, '[class*="chapter"], [class*="Chapter"]').replace(/[^\d.,]/g, '')
      };
    }).filter((item) => item.url && item.title && !seen.has(item.url) && seen.add(item.url));
    const currentPage = Math.max(1, Number(page) || 1);
    return {
      items,
      totalPages: items.length === PAGE_SIZE ? currentPage + 1 : currentPage,
      hasMore: items.length === PAGE_SIZE,
      totalText: ''
    };
  }

  async function detail(url) {
    const manga = mangaData(url);
    const doc = parse(await fetchText(manga.url));
    const title = text(doc, 'h1') || clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content')) || clean(doc.title);
    const cover = coverFrom(doc);
    const synopsis = clean(doc.querySelector('meta[name="description"]')?.getAttribute('content')
      || doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
      || doc.querySelector('[class*="sinopsis"], [class*="synopsis"], [id*="sinopsis"], [id*="synopsis"]')?.textContent);
    const genres = [...doc.querySelectorAll('a[href*="genre"], a[href*="genero"], [class*="genre"] a, [class*="genero"] a')]
      .map((element) => clean(element.textContent)).filter(Boolean);
    const facts = [...doc.querySelectorAll('dt, th, .label, strong, b')].map((label) => {
      const key = clean(label.textContent).replace(/:$/, '').toLowerCase();
      const value = clean(label.nextElementSibling?.textContent || label.parentElement?.textContent?.replace(label.textContent, ''));
      return [key, value];
    });
    const fact = (pattern) => facts.find(([key]) => pattern.test(key))?.[1] || '';
    const chaptersData = await chapterList(manga.id);
    const chapters = chaptersData
      .sort((a, b) => Number(a.number) - Number(b.number))
      .map((item) => ({
        url: chapterUrl(manga, item),
        title: `Capítulo ${item.number}`,
        date: clean(item.date || item.publishDate || '')
      }));
    chapterCache.set(manga.id, { manga, chapters });
    if (chapterCache.size > 20) chapterCache.delete(chapterCache.keys().next().value);
    return {
      title,
      cover,
      altTitles: clean(doc.querySelector('[class*="alternative"], [class*="alternate"], [class*="sinonimo"]')?.textContent),
      genres: [...new Set(genres)],
      facts: {
        estado: fact(/estado|status/),
        status: fact(/estado|status/),
        tipo: fact(/tipo|type/) || 'Manga',
        autor: fact(/autor|author|artist/),
        vistas: fact(/vista|view/)
      },
      sinopsis: synopsis,
      chapters
    };
  }

  async function chapter(url) {
    const parsed = new URL(url, BASE);
    const mangaId = parsed.searchParams.get('mangaIdentification') || '';
    const chapterId = parsed.searchParams.get('identification') || '';
    const cached = chapterCache.get(mangaId);
    if (!chapterId || !mangaId) throw new Error('No se pudo identificar el manga y el capítulo de InManga');
    const chapterHtml = await fetchText(`${PAGE_LIST}?identification=${encodeURIComponent(chapterId)}`);
    const doc = parse(chapterHtml);
    const pages = [...doc.querySelectorAll('select.PageListClass option[value]')]
      .map((option) => clean(option.getAttribute('value')))
      .filter((value) => /^[\w-]+$/.test(value))
      .map((id) => `${PAGES}/${encodeURIComponent(id)}`);
    const options = cached?.chapters || [];
    const index = options.findIndex((item) => item.url === url || new URL(item.url).searchParams.get('identification') === chapterId);
    return {
      label: options[index]?.title || text(doc, 'h1, h2') || 'Capítulo',
      mangaUrl: cached?.manga.url || `${BASE}/ver/manga/${encodeURIComponent(parsed.searchParams.get('slug') || '')}/${encodeURIComponent(mangaId)}`,
      pages: [...new Set(pages)],
      options,
      prev: index > 0 ? { title: options[index - 1].title, url: options[index - 1].url } : null,
      next: index >= 0 && index + 1 < options.length ? { title: options[index + 1].title, url: options[index + 1].url } : null
    };
  }

  return { id: 'inmanga', name: 'InManga', catalog, detail, chapter };
}
