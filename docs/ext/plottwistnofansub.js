const BASE = 'https://plotnofansub.com';

export default function createSource({ fetchText, parse }) {
  const abs = (value) => {
    if (!value) return '';
    try { return new URL(value, BASE).href; } catch { return ''; }
  };
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const text = (element, selector) => clean(element?.querySelector(selector)?.textContent);
  const imageUrl = (image) => {
    if (!image) return '';
    for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'src']) {
      const value = clean(image.getAttribute(attr));
      if (value && !/^(?:data:|javascript:|about:|#)/i.test(value)
        && !/(?:placeholder|default|blank|spacer|pixel)\.(?:gif|png)(?:[?#]|$)/i.test(value)) {
        return abs(value);
      }
    }
    return '';
  };
  const isMangaUrl = (url) => {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      return parts.length === 2 && parts[0] === 'manga';
    } catch { return false; }
  };

  function mapMangaCard(anchor) {
    const url = abs(anchor.getAttribute('href'));
    if (!url || !isMangaUrl(url)) return null;
    const card = anchor.closest('.c-tabs-item__content, .page-item-detail, .item, article, li') || anchor.parentElement || anchor;
    const image = card.querySelector('img');
    const title = clean(anchor.getAttribute('title')) || text(anchor, '.post-title, h3, h4')
      || clean(image?.getAttribute('alt')) || clean(anchor.textContent);
    if (!title) return null;
    const chapterText = text(card, '.latest-chapter, .chapter, [class*="chapter"]');
    return {
      url,
      title,
      cover: imageUrl(image),
      author: text(card, '.mg_author, .author, [class*="author"]'),
      type: text(card, '.mg_type, .type, [class*="type"]'),
      lastChapter: (chapterText.match(/[\d]+(?:[.,][\d]+)*/g) || []).at(-1) || ''
    };
  }

  function mangaCards(doc) {
    const seen = new Set();
    return [...doc.querySelectorAll('a[href*="/manga/"]')]
      .map(mapMangaCard)
      .filter((item) => item && !seen.has(item.url) && seen.add(item.url));
  }

  async function catalog({ q = '', page = 1, __cytlexRequestId } = {}) {
    const currentPage = Math.max(1, Number(page) || 1);
    const params = new URLSearchParams();
    if (q.trim()) {
      params.set('s', q.trim());
      params.set('post_type', 'wp-manga');
    }
    const path = q.trim() ? (currentPage > 1 ? `/page/${currentPage}/` : '/')
      : (currentPage > 1 ? `/manga/page/${currentPage}/` : '/manga/');
    const query = params.toString();
    const url = `${BASE}${path}${query ? `?${query}` : ''}`;
    const doc = parse(await fetchText(url, __cytlexRequestId));
    const items = mangaCards(doc);
    const hasMore = !!doc.querySelector('.wp-pagenavi a.nextpostslink, .pagination a.next, a[rel="next"]');
    return {
      items,
      totalPages: hasMore ? currentPage + 1 : currentPage,
      hasMore,
      totalText: ''
    };
  }

  async function detail(mangaUrl) {
    const url = abs(mangaUrl);
    const doc = parse(await fetchText(url));
    const title = text(doc, 'h1, .post-title h1, .post-title')
      || clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content'))
      || clean(doc.title).split('|')[0];
    const cover = imageUrl(doc.querySelector('.summary_image img, .summary_image, .manga-thumb img, img.wp-post-image'))
      || abs(doc.querySelector('meta[property="og:image"]')?.getAttribute('content'));
    const synopsis = text(doc, '.description-summary, .summary__content, .manga-summary, .description, [itemprop="description"]');
    const genres = [...doc.querySelectorAll('.genres-content a, .genres a, .manga-genres a, a[href*="/manga-genre/"]')]
      .map((element) => clean(element.textContent)).filter(Boolean);
    const info = [...doc.querySelectorAll('.post-content_item, .post-content_item *, .summary-content, .summary-content *')];
    const fact = (pattern) => {
      for (const element of info) {
        const label = clean(element.querySelector('.summary-heading, .summary-heading *')?.textContent || element.textContent);
        if (!pattern.test(label)) continue;
        const value = clean(element.querySelector('.summary-content, .summary-content *')?.textContent
          || element.nextElementSibling?.textContent || element.parentElement?.textContent?.replace(label, ''));
        if (value && value !== label) return value;
      }
      return '';
    };

    const chapters = [];
    const seen = new Set();
    for (const anchor of doc.querySelectorAll('.wp-manga-chapter a, .listing-chapters_wrap a, a[href]')) {
      const chapterUrl = abs(anchor.getAttribute('href'));
      if (!chapterUrl || chapterUrl === url || seen.has(chapterUrl)) continue;
      let parsed;
      try { parsed = new URL(chapterUrl); } catch { continue; }
      const mangaPath = new URL(url).pathname.replace(/\/$/, '');
      if (parsed.origin !== new URL(url).origin || !parsed.pathname.startsWith(`${mangaPath}/`)) continue;
      const chapterTitle = clean(anchor.textContent);
      if (!chapterTitle) continue;
      seen.add(chapterUrl);
      chapters.push({ url: chapterUrl, title: chapterTitle, date: clean(anchor.closest('li, .wp-manga-chapter')?.querySelector('i, time')?.textContent) });
    }

    return {
      title,
      cover,
      altTitles: fact(/alternativo|alternative|sin[oó]nimo/i),
      genres: [...new Set(genres)],
      facts: {
        estado: fact(/estado|status/i),
        status: fact(/estado|status/i),
        tipo: fact(/tipo|type/i),
        autor: fact(/autor|author/i),
        vistas: fact(/visitas|views/i)
      },
      sinopsis: synopsis,
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const url = abs(chapterUrl);
    const doc = parse(await fetchText(url));
    const reader = doc.querySelector('.reading-content, #readerarea, .chapter-content, .page-break') || doc;
    const pages = [...reader.querySelectorAll('img')]
      .map(imageUrl)
      .filter((src) => src && !/logo|avatar|banner|ads?/i.test(src));
    const mangaLink = [...doc.querySelectorAll('.breadcrumb a[href*="/manga/"], a[href*="/manga/"]')]
      .map((anchor) => abs(anchor.getAttribute('href')))
      .find((href) => href && isMangaUrl(href)) || '';
    const prev = doc.querySelector('.nav-previous a, a.prev_page, a[rel="prev"]');
    const next = doc.querySelector('.nav-next a, a.next_page, a[rel="next"]');
    const chapterLabel = text(doc, '.chapter-heading, .entry-title, h1, h2') || clean(doc.title).split('|')[0];
    const link = (anchor) => {
      const href = abs(anchor?.getAttribute('href'));
      return href ? { title: clean(anchor?.textContent) || 'Capítulo', url: href } : null;
    };
    return {
      label: chapterLabel,
      mangaUrl: mangaLink,
      imageReferer: url,
      pages: [...new Set(pages)],
      options: [],
      prev: link(prev),
      next: link(next)
    };
  }

  return { id: 'plottwistnofansub', name: 'Plot Twist No Fansub', catalog, detail, chapter };
}
