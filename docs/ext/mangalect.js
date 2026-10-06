export default function createSource({ fetchText, parse }) {
  const base = 'https://mangalect.org';
  const assets = 'https://images.mangalect.org/file/leermangaesp';
  const PAGE_SIZE = 20;

  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };

  // El sitio sirve las portadas como rutas relativas colgadas del mirror.
  const coverUrl = (p) => (p ? (/^https?:/i.test(p) ? p : `${assets}/${p}`) : '');

  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  const json = async (url) => {
    try {
      return JSON.parse(await fetchText(url));
    } catch {
      return null;
    }
  };

  async function catalog({ q = '', genre = '', page: p = 1 } = {}) {
    const params = new URLSearchParams({
      page: String(p),
      page_size: String(PAGE_SIZE)
    });
    if (q) params.set('query', q);
    if (genre) params.set('generos', genre);

    const data = await json(`${base}/api/buscar_mangas/?${params}`);
    if (!data) return { items: [], totalPages: 1, totalText: '' };

    const items = (data.resultados || [])
      .map((r) => ({
        url: abs(`/info/${r.slug}/`),
        title: r.titulo || '',
        cover: coverUrl(r.portada),
        type: r.tipo || '',
        lastChapter: r.ultimo_capitulo ? String(r.ultimo_capitulo) : ''
      }))
      .filter((x) => x.url && x.title);

    return {
      items,
      totalPages: Math.max(1, Number(data.total_pages) || 1),
      totalText: data.total_results ? String(data.total_results) : ''
    };
  }

  async function detail(mangaUrl) {
    const startUrl = abs(mangaUrl);
    const doc = parse(await fetchText(startUrl));

    const data = doc.body;
    const coverImg = doc.querySelector('img.manga-cover') || doc.querySelector('.manga-cover img');
    const status = text(doc, '.status-text');
    const portadaRel = data.getAttribute('data-portada-rel') || '';

    const chapters = [];
    const seen = new Set();
    for (const el of doc.querySelectorAll('.chapter-card')) {
      if (el.classList.contains('chapter-card-full')) continue;
      const a = el.querySelector('a.chapter-link');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      if (!href || href === '#') continue;
      const url = abs(href);
      if (seen.has(url)) continue;
      seen.add(url);
      chapters.push({
        url,
        title: text(el, '.chapter-title') || (a.textContent || '').trim(),
        date: text(el, '.chapter-date')
      });
    }

    return {
      title: text(doc, 'h1.manga-title') || doc.title.split('|')[0].trim(),
      cover: coverImg?.getAttribute('src') ? abs(coverImg.getAttribute('src')) : coverUrl(portadaRel),
      altTitles: text(doc, '.alternate-titles'),
      genres: [...doc.querySelectorAll('.genero-item')].map((e) => e.textContent.trim()).filter(Boolean),
      facts: {
        estado: status,
        status,
        tipo: data.getAttribute('data-manga-tipo') || '',
        autor: '',
        vistas: ''
      },
      sinopsis: text(doc, '.synopsis'),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const url = abs(chapterUrl);
    const doc = parse(await fetchText(url));

    const pages = [...doc.querySelectorAll('img.manga-image')]
      .filter((el) => !el.classList.contains('single-manga-page'))
      .map((el) => abs(el.getAttribute('src')))
      .filter(Boolean);

    const slug = (url.match(/\/lectura\/([^/]+)\//) || [])[1] || '';
    const mangaUrl = slug ? abs(`/info/${slug}/`) : '';

    const prevEl = doc.querySelector('a.prev-button');
    const nextEl = doc.querySelector('a.next-button');
    const href = (el) => {
      const h = el?.getAttribute('href') || '';
      return h ? abs(h) : '';
    };

    return {
      label: text(doc, 'h1') || '',
      mangaUrl,
      pages: [...new Set(pages)],
      options: [],
      prev: prevEl && href(prevEl) ? { title: 'Anterior', url: href(prevEl) } : null,
      next: nextEl && href(nextEl) ? { title: 'Siguiente', url: href(nextEl) } : null
    };
  }

  return { id: 'mangalect', name: 'MangaLect', catalog, detail, chapter };
}
