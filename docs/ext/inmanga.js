const BASE = 'https://inmanga.com';
const CHAPTERS = `${BASE}/chapter/getall`;
const PAGE_LIST = `${BASE}/chapter/chapterIndexControls`;
const IMAGE_CDN = 'https://cdn1.intomanga.com/i/m';
const PAGE_SIZE = 20;

export default function createSource({ fetchText, fetchPostText, parse }) {
  const chapterCache = new Map();

  const abs = (value) => {
    if (!value) return '';
    try { return new URL(value, BASE).href; } catch { return ''; }
  };

  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/:$/, '').toLowerCase();
  const text = (element, selector) => clean(element.querySelector(selector)?.textContent);
  const imageUrl = (image) => {
    if (!image) return '';
    const linkedImage = image.closest?.('a[href]')?.getAttribute('href') || '';
    const picture = image.closest?.('picture');
    const srcsets = [
      ...[...(picture?.querySelectorAll('source[srcset], source[data-srcset]') || [])]
        .flatMap((source) => [source.getAttribute('srcset'), source.getAttribute('data-srcset')]),
      image.getAttribute('srcset'),
      image.getAttribute('data-srcset')
    ].filter(Boolean);
    const srcsetCandidates = srcsets.flatMap((srcset) => srcset.split(',').map((entry) => {
      const [url, descriptor = ''] = entry.trim().split(/\s+/);
      const amount = Number.parseFloat(descriptor);
      const score = descriptor.endsWith('w') ? amount : descriptor.endsWith('x') ? amount * 1000 : 0;
      return { url, score };
    })).filter((candidate) => candidate.url);
    const largestSrc = srcsetCandidates.length
      ? (srcsetCandidates.some((candidate) => candidate.score > 0)
        ? srcsetCandidates.sort((a, b) => b.score - a.score)[0].url
        : srcsetCandidates.at(-1).url)
      : '';
    const candidates = [
      /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(linkedImage) ? linkedImage : '',
      image.getAttribute('data-original'),
      image.getAttribute('data-original-src'),
      image.getAttribute('data-full'),
      image.getAttribute('data-zoom-image'),
      image.getAttribute('data-large'),
      image.getAttribute('data-src'),
      image.getAttribute('data-lazy-src'),
      image.getAttribute('data-url'),
      largestSrc,
      image.getAttribute('data-cfsrc'),
      image.getAttribute('src'),
      image.getAttribute('content')
    ];
    for (const candidate of candidates) {
      const value = clean(candidate);
      if (!value || /^(?:data:|javascript:|about:|#)/i.test(value)) continue;
      if (/(?:placeholder|no[-_]?image|default[-_]?cover|blank\.gif|transparent\.gif|pixel\.(?:gif|png)|spacer\.(?:gif|png)|\/logo(?:[./_-]|$))/i.test(value)) continue;
      const resolved = abs(value);
      if (resolved) return resolved;
    }
    return '';
  };
  const coverFrom = (doc) => {
    const selectors = [
      '.manga-cover img',
      'img[class*="cover" i]',
      'img[id*="cover" i]',
      '[data-cover] img',
      '[data-thumbnail] img',
      'img[src*="/i/m/" i]',
      'img[data-src*="/i/m/" i]',
      'img[data-original*="/i/m/" i]',
      'img[src*="/thumbnails/manga/" i]',
      'img[data-src*="/thumbnails/manga/" i]',
      'img[src*="/images/manga/" i]',
      'img[data-src*="/images/manga/" i]',
      'img[data-original*="/images/manga/" i]'
    ];
    for (const selector of selectors) {
      const image = doc.querySelector(selector);
      const source = imageUrl(image);
      if (source) return source;
    }
    const metaCover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
    if (metaCover) {
      const source = imageUrl({ getAttribute: (name) => name === 'content' ? metaCover : null });
      if (source) return source;
    }
    return '';
  };
  const isSeoSynopsis = (value, title) => {
    const content = normalized(value);
    if (!content) return true;
    const titleKey = normalized(title);
    const titleMentions = titleKey ? content.split(titleKey).length - 1 : 0;
    return /\b(?:online|gratis|leer)\b/.test(content) && titleMentions >= 2;
  };
  const synopsisFrom = (doc, title) => {
    const selectors = [
      '[itemprop="description"]',
      '[class*="synopsis" i]', '[id*="synopsis" i]',
      '[class*="sinopsis" i]', '[id*="sinopsis" i]',
      '[class*="manga-description" i]', '[id*="manga-description" i]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const element of doc.querySelectorAll(selector)) candidates.push(clean(element.textContent));
    }
    for (const element of doc.querySelectorAll('main p, article p, p')) candidates.push(clean(element.textContent));
    for (const element of doc.querySelectorAll('[class*="description" i], [id*="description" i]')) candidates.push(clean(element.textContent));
    const content = candidates.find((value) => value.length > 60 && !isSeoSynopsis(value, title));
    if (content) return content;
    const meta = clean(doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
      || doc.querySelector('meta[name="description"]')?.getAttribute('content'));
    return isSeoSynopsis(meta, title) ? '' : meta;
  };
  const factValue = (doc, labels) => {
    const wanted = new Set(labels.map(normalized));
    for (const label of doc.querySelectorAll('label, dt, th, strong, b, span, div, p')) {
      if (normalized(label.textContent) && wanted.has(normalized(label.textContent))) {
        const adjacent = [label.previousElementSibling, label.nextElementSibling]
          .map((element) => clean(element?.textContent))
          .find((value) => value && !wanted.has(normalized(value)));
        if (adjacent) return adjacent;
        const parentText = clean(label.parentElement?.textContent);
        const [before, after] = parentText.split(new RegExp(label.textContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        const siblingValue = clean(before) || clean(after);
        if (siblingValue && !wanted.has(normalized(siblingValue))) return siblingValue;
      }
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

  async function catalog({ q = '', page = 1, __cytlexRequestId } = {}) {
    const query = clean(q);
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
    }, __cytlexRequestId);
    const doc = parse(html);
    const seen = new Set();
    const items = [...doc.querySelectorAll('a[href*="/ver/manga/"]')].map((anchor) => {
      const url = abs(anchor.getAttribute('href'));
      const card = anchor.closest('article, li') || anchor;
      const image = anchor.querySelector('img') || card.querySelector('img');
      const cover = imageUrl(image)
        || imageUrl(anchor)
        || imageUrl(card)
        || abs(anchor.getAttribute('data-cover') || anchor.getAttribute('data-thumbnail')
          || card.getAttribute('data-cover') || card.getAttribute('data-thumbnail'));
      return {
        url,
        title: text(anchor, 'h4, h3, .title') || clean(anchor.getAttribute('title')) || clean(image?.getAttribute('alt')) || clean(anchor.textContent),
        cover,
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
    const synopsis = synopsisFrom(doc, title);
    const genres = [...doc.querySelectorAll('a[href*="genre"], a[href*="genero"], [class*="genre"] a, [class*="genero"] a')]
      .map((element) => clean(element.textContent)).filter(Boolean);
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
        estado: factValue(doc, ['Estado', 'Status']),
        status: factValue(doc, ['Estado', 'Status']),
        tipo: factValue(doc, ['Tipo', 'Type']) || 'Manga',
        autor: factValue(doc, ['Autor', 'Author', 'Artist']),
        vistas: factValue(doc, ['Vistas', 'Views']),
        publicacion: factValue(doc, ['Publicación', 'Publication']),
        periodicidad: factValue(doc, ['Periodicidad', 'Frequency']),
        proximo: factValue(doc, ['Próximo capítulo', 'Next chapter'])
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
    const chapterUuid = clean(doc.querySelector('#ChapterIdentification')?.value) || chapterId.toLowerCase();
    const chapterNumber = clean(doc.querySelector('#ChapterNumber')?.value) || parsed.searchParams.get('number') || '';
    const mangaSlug = parsed.searchParams.get('slug') || cached?.manga.slug || '';
    const pageList = doc.querySelector('#PageList');
    const pageElements = pageList?.children.length
      ? [...pageList.children]
      : [...doc.querySelectorAll('select.PageListClass option[value]')];
    const pageIds = pageElements
      .map((element) => clean(element.getAttribute('value') || element.value))
      .filter((value) => /^[\w-]+$/.test(value))
      .filter((value, index, values) => values.indexOf(value) === index);
    const imageReferer = mangaSlug && chapterNumber
      ? `${BASE}/ver/manga/${encodeURIComponent(mangaSlug)}/${encodeURIComponent(chapterNumber)}/${encodeURIComponent(chapterUuid)}`
      : `${BASE}/`;
    const pages = pageIds.map((id) => `${IMAGE_CDN}/${encodeURIComponent(mangaId)}/c/${encodeURIComponent(chapterUuid)}/o/${encodeURIComponent(id)}.jpg`);
    const options = cached?.chapters || [];
    const index = options.findIndex((item) => item.url === url || new URL(item.url).searchParams.get('identification') === chapterId);
    return {
      label: options[index]?.title || text(doc, 'h1, h2') || 'Capítulo',
      mangaUrl: cached?.manga.url || `${BASE}/ver/manga/${encodeURIComponent(parsed.searchParams.get('slug') || '')}/${encodeURIComponent(mangaId)}`,
      imageReferer,
      pages: [...new Set(pages)],
      options,
      prev: index > 0 ? { title: options[index - 1].title, url: options[index - 1].url } : null,
      next: index >= 0 && index + 1 < options.length ? { title: options[index + 1].title, url: options[index + 1].url } : null
    };
  }

  return { id: 'inmanga', name: 'InManga', catalog, detail, chapter };
}
