export default function createSource({ fetchText, parse }) {
  const base = 'https://mangalect.org';

  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };

  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  function mapCards(doc) {
    return [...doc.querySelectorAll('.manga-card-v2')]
      .map((el) => {
        const a = el.querySelector('a[href]');
        const img = el.querySelector('img');
        return {
          url: abs(a?.getAttribute('href')),
          title: text(el, '.overlay-text-title'),
          cover: abs(img?.getAttribute('data-src') || img?.getAttribute('src')),
          type: text(el, '.format-badge')
        };
      })
      .filter((x) => x.url && x.title);
  }

  async function catalog({ q = '' } = {}) {
    if (q) {
      const raw = await fetchText(`${base}/api/api/busqueda-rapida/?q=${encodeURIComponent(q)}`);
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }
      const items = (data?.resultados || [])
        .map((r) => ({
          url: abs(`/info/${r.slug}/`),
          title: r.titulo || '',
          cover: abs(r.portada),
          type: r.tipo || ''
        }))
        .filter((x) => x.url && x.title);
      return { items, totalPages: 1, totalText: '' };
    }

    const doc = parse(await fetchText(`${base}/`));
    return { items: mapCards(doc), totalPages: 1, totalText: '' };
  }

  async function detail(mangaUrl) {
    const startUrl = abs(mangaUrl);
    const first = parse(await fetchText(startUrl));
    const coverImg = first.querySelector('img.manga-cover') || first.querySelector('.manga-cover img');
    const status = text(first, '.status-text');

    const chapters = [];
    const seen = new Set();

    const collect = (doc, pageUrl) => {
      for (const el of doc.querySelectorAll('.chapter-card')) {
        if (el.classList.contains('chapter-card-full')) continue;
        const a = el.querySelector('a.chapter-link') || el.querySelector('a[href]');
        if (!a || a.classList.contains('btn-ver-mas')) continue;
        const href = a.getAttribute('href') || '';
        if (!href || href === '#') continue;
        const url = new URL(href, pageUrl).href;
        if (seen.has(url)) continue;
        seen.add(url);
        chapters.push({
          url,
          title: text(el, '.chapter-title') || (a.textContent || '').trim(),
          date: text(el, '.chapter-date')
        });
      }
    };

    collect(first, startUrl);

    const visited = new Set([startUrl]);
    let pageUrl = startUrl;
    let doc = first;
    for (let i = 0; i < 200; i++) {
      const href = doc.querySelector('#more-link, .btn-ver-mas')?.getAttribute('href');
      if (!href) break;
      const nextUrl = new URL(href, pageUrl).href;
      if (visited.has(nextUrl)) break;
      visited.add(nextUrl);
      pageUrl = nextUrl;
      doc = parse(await fetchText(pageUrl));
      collect(doc, pageUrl);
    }

    return {
      title: text(first, 'h1.manga-title'),
      cover: abs(coverImg?.getAttribute('src')),
      altTitles: text(first, '.alternate-titles'),
      genres: [...first.querySelectorAll('.genero-item')].map((e) => e.textContent.trim()).filter(Boolean),
      facts: { estado: status, status, tipo: '', autor: '', vistas: '' },
      sinopsis: text(first, '.synopsis'),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const doc = parse(await fetchText(abs(chapterUrl)));
    const pages = [...doc.querySelectorAll('img.manga-image')]
      .filter((el) => !el.classList.contains('single-manga-page'))
      .map((el) => abs(el.getAttribute('src')))
      .filter(Boolean);
    const slug = (String(chapterUrl).match(/lectura\/([^/]+)\//) || [])[1];
    return {
      label: text(doc, 'h1') || '',
      mangaUrl: slug ? abs(`/info/${slug}/`) : '',
      pages: [...new Set(pages)],
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'mangalect', name: 'MangaLect', catalog, detail, chapter };
}
