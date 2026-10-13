export default function createSource({ fetchText, parse }) {
  const base = 'https://onfmangas.com';

  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };

  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  function mapCards(doc) {
    return [...doc.querySelectorAll('.manga-card')]
      .map((el) => {
        const a = el.querySelector('a[href]');
        const img = el.querySelector('img');
        return {
          url: abs(a?.getAttribute('href')),
          title: text(el, '.manga-title') || (img?.getAttribute('alt') || '').trim(),
          cover: abs(img?.getAttribute('src') || img?.getAttribute('data-src')),
          type: text(el, '.card-badge')
        };
      })
      .filter((x) => x.url && x.title);
  }

  function decodeChapters(html) {
    const m = html.match(/_hex\s*=\s*"([0-9a-fA-F]+)"/);
    if (!m) return [];
    let list;
    try {
      const decoded = decodeURIComponent(m[1].replace(/(..)/g, '%$1'));
      list = JSON.parse(decoded);
    } catch {
      return [];
    }
    if (!Array.isArray(list)) return [];
    return list
      .map((c) => ({
        url: abs(c.url),
        title: c.titulo || c.titulo_str || '',
        date: c.fecha_str || c.fecha_subida || ''
      }))
      .filter((x) => x.url);
  }

  async function catalog({ q = '' } = {}) {
    const url = q ? `${base}/buscar.php?q=${encodeURIComponent(q)}` : `${base}/`;
    const doc = parse(await fetchText(url));
    return { items: mapCards(doc), totalPages: 1, totalText: '' };
  }

  async function detail(mangaUrl) {
    const html = await fetchText(abs(mangaUrl));
    const doc = parse(html);
    const coverImg = doc.querySelector('img.manga-poster');
    const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    return {
      title: text(doc, 'h1.manga-title'),
      cover: abs(coverImg?.getAttribute('src')),
      altTitles: '',
      genres: [...doc.querySelectorAll('.genre-tag')].map((e) => e.textContent.trim()).filter(Boolean),
      facts: { estado: '', status: '', tipo: '', autor: '', vistas: '' },
      sinopsis: desc.trim(),
      chapters: decodeChapters(html)
    };
  }

  async function chapter(chapterUrl) {
    const html = await fetchText(abs(chapterUrl));
    const outer = parse(html);
    const ns = html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i);
    const reader = parse(ns ? ns[1] : html);
    const pages = [...reader.querySelectorAll('img.manga-page')]
      .map((el) => abs(el.getAttribute('src') || el.getAttribute('data-src')))
      .filter(Boolean);
    return {
      label: text(outer, 'h1') || '',
      mangaUrl: '',
      pages: [...new Set(pages)],
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'onfmangas', name: 'ONF Mangas', catalog, detail, chapter };
}
