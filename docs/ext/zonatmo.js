export default function createSource({ fetchText, parse }) {
  const base = 'https://zonatmo.org';

  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };

  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  const typeOf = (url) => (String(url || '').match(/\/library\/([^/]+)\//) || [])[1] || '';

  const READABLE = new Set(['manga', 'manhwa', 'manhua']);

  const caps = (el) => (el?.textContent || '').match(/([\d.,]+)\s*cap/i)?.[1] || '';

  function mapCards(doc) {
    return [...doc.querySelectorAll('#library-results .element')]
      .map((el) => {
        const a = el.querySelector('a[href*="/library/"]');
        const url = abs(a?.getAttribute('href'));
        if (!url || !READABLE.has(typeOf(url))) return null;
        const img = el.querySelector('img.cover-bg-img');
        const cover = img?.getAttribute('src') || el.querySelector('.lazy-cover')?.getAttribute('data-bg');
        return {
          url,
          title: text(el, '.thumbnail-title h4'),
          cover: abs(cover),
          type: text(el, '.book-type'),
          lastChapter: caps(el.querySelector('.book-meta-item'))
        };
      })
      .filter((x) => x && x.title);
  }

  async function catalog({ q = '', page = 1 } = {}) {
    const url = q
      ? `${base}/biblioteca?title=${encodeURIComponent(q)}&page=${page}`
      : `${base}/biblioteca?page=${page}`;
    const doc = parse(await fetchText(url));
    const items = mapCards(doc);
    return {
      items,
      totalPages: items.length ? page + 1 : Math.max(page - 1, 1),
      totalText: ''
    };
  }

  async function detail(mangaUrl) {
    const doc = parse(await fetchText(abs(mangaUrl)));

    const h1 = doc.querySelector('h1.element-title');
    const title = ((h1?.firstChild?.textContent || '') || '').replace(/\s+/g, ' ').trim();

    const genres = [];
    const genreHeading = [...doc.querySelectorAll('h5.element-subtitle')]
      .find((h) => /géneros/i.test(h.textContent));
    let node = genreHeading?.nextElementSibling;
    while (node && node.tagName === 'H6') {
      const g = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (g) genres.push(g);
      node = node.nextElementSibling;
    }

    const status = text(doc, '.book-status');
    const author = text(doc, 'a[href*="filter_by=author"]');
    const sinopsis = text(doc, '#manga-synopsis');
    const altTitles = [...new Set(
      [...doc.querySelectorAll('.synonyms-wrap .syn-badge')]
        .flatMap((e) => (e.textContent || '').split(';'))
        .map((s) => s.replace(/\s+/g, ' ').trim())
        .filter((s) => s && s.toLowerCase() !== title.toLowerCase())
    )].join(' · ');

    // #chapters-list trae los 10 últimos y #chapters-hidden, oculto por CSS, el
    // resto. Leer solo el primero deja la obra truncada.
    const chapterEls = [
      ...doc.querySelectorAll('#chapters-list li.upload-link'),
      ...doc.querySelectorAll('#chapters-hidden li.upload-link')
    ];
    const seenUrls = new Set();
    const chapters = chapterEls
      .map((el) => {
        const a = el.querySelector('.chapter-detail a[href*="/view_uploads/"]');
        const url = abs(a?.getAttribute('href'));
        if (!url || seenUrls.has(url)) return null;
        seenUrls.add(url);
        const date = text(el, '.chapter-detail .fa-calendar') || text(el, '.chapter-row-date');
        return { url, title: text(el, '.chapter-number'), date };
      })
      .filter(Boolean)
      .reverse();

    return {
      title,
      cover: abs(doc.querySelector('img.book-thumbnail')?.getAttribute('src')),
      altTitles,
      genres,
      facts: { estado: status, status, tipo: text(doc, 'h1.book-type'), autor: author, vistas: '' },
      sinopsis,
      chapters
    };
  }

  function backLink(doc) {
    const a = doc.querySelector('#reader-header a[href*="/library/"]');
    return abs(a?.getAttribute('href'));
  }

  async function chapter(chapterUrl) {
    const doc = parse(await fetchText(abs(chapterUrl)));

    const pages = [...doc.querySelectorAll('#reader-wrap .reader-img-wrap img.reader-image')]
      .map((el) => abs(el.getAttribute('src')))
      .filter(Boolean);

    const options = [...doc.querySelectorAll('#chapterSelect option')]
      .map((o) => ({ url: abs(o.getAttribute('value')), title: (o.textContent || '').replace(/\s+/g, ' ').trim() }))
      .filter((o) => o.url && o.title)
      .reverse();

    const idx = options.findIndex((o) => o.url === abs(chapterUrl));
    const prev = idx >= 0 ? options[idx + 1] || null : null;
    const next = idx >= 0 ? options[idx - 1] || null : null;

    return {
      label: (doc.querySelector('#chapterSelect option[selected]')?.textContent || '').replace(/\s+/g, ' ').trim(),
      mangaUrl: backLink(doc),
      pages,
      options,
      prev: prev ? { title: prev.title, url: prev.url } : null,
      next: next ? { title: next.title, url: next.url } : null
    };
  }

  return { id: 'zonatmo', name: 'ZonaTMO', catalog, detail, chapter };
}
