// Cytlex · MangaLect (LeerMangaEsp) — https://mangalect.org
// Tipo "module": catálogo/detalle/capítulos en HTML + búsqueda por API JSON.

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
    const doc = parse(await fetchText(abs(mangaUrl)));
    const coverImg = doc.querySelector('img.manga-cover') || doc.querySelector('.manga-cover img');
    const status = text(doc, '.status-text');

    const chapters = [...doc.querySelectorAll('.chapter-card')]
      .map((el) => {
        const a = el.querySelector('a.chapter-link') || el.querySelector('a[href]');
        const href = a?.getAttribute('href') || '';
        return {
          url: href && href !== '#' ? abs(href) : '',
          title: text(el, '.chapter-title') || (a?.textContent || '').trim(),
          date: text(el, '.chapter-date')
        };
      })
      .filter((x) => x.url);

    return {
      title: text(doc, 'h1.manga-title'),
      cover: abs(coverImg?.getAttribute('src')),
      altTitles: text(doc, '.alternate-titles'),
      genres: [...doc.querySelectorAll('.genero-item')].map((e) => e.textContent.trim()).filter(Boolean),
      facts: { estado: status, status, tipo: '', autor: '', vistas: '' },
      sinopsis: text(doc, '.synopsis'),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const doc = parse(await fetchText(abs(chapterUrl)));
    const pages = [...doc.querySelectorAll('img.manga-image')]
      .filter((el) => !el.classList.contains('single-manga-page'))
      .map((el) => abs(el.getAttribute('src')))
      .filter(Boolean);
    return {
      label: text(doc, 'h1') || '',
      mangaUrl: '',
      pages: [...new Set(pages)],
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'mangalect', name: 'MangaLect (LeerMangaEsp)', catalog, detail, chapter };
}
