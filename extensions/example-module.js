// Extensión de Cytlex (tipo "module").
//
// Exporta una factory que recibe el contexto y devuelve la fuente.
//   ctx.fetchText(url) -> Promise<string>  (petición vía proceso principal, sin CORS)
//   ctx.parse(html)    -> Document         (DOMParser del navegador)
//
// Devuelve la misma forma que usa la fuente integrada (ver README).

export default function createSource({ fetchText, parse }) {
  const base = 'https://example.com';
  const abs = (u) => {
    if (!u) return '';
    try { return new URL(u, base).href; } catch { return u; }
  };
  const text = (el, sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  async function catalog({ q = '', genre = '', page = 1 } = {}) {
    const url = `${base}/buscar?q=${encodeURIComponent(q)}&genero=${encodeURIComponent(genre)}&page=${page}`;
    const doc = parse(await fetchText(url));
    const items = [...doc.querySelectorAll('.manga-item')]
      .map((el) => ({
        url: abs(el.querySelector('a')?.getAttribute('href')),
        title: text(el, '.title'),
        cover: abs(el.querySelector('img')?.getAttribute('src')),
        type: text(el, '.type'),
        lastChapter: text(el, '.chapter')
      }))
      .filter((x) => x.url && x.title);
    return { items, totalPages: page, totalText: '' };
  }

  async function detail(mangaUrl) {
    const doc = parse(await fetchText(abs(mangaUrl)));
    const chapters = [...doc.querySelectorAll('.chapter-item')]
      .map((el) => ({
        url: abs(el.querySelector('a')?.getAttribute('href')),
        title: text(el, 'a'),
        date: text(el, '.date')
      }))
      .filter((x) => x.url);
    return {
      title: text(doc, 'h1') || 'Sin título',
      cover: abs(doc.querySelector('.cover img')?.getAttribute('src')),
      altTitles: text(doc, '.alt'),
      genres: [...doc.querySelectorAll('.genres a')].map((a) => a.textContent.trim()).filter(Boolean),
      facts: { estado: '', status: '', tipo: '', autor: '', vistas: '' },
      sinopsis: text(doc, '.synopsis'),
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const doc = parse(await fetchText(abs(chapterUrl)));
    return {
      label: text(doc, 'h1'),
      mangaUrl: abs(doc.querySelector('a.back')?.getAttribute('href')),
      pages: [...doc.querySelectorAll('.reader img')].map((img) => abs(img.getAttribute('src'))),
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'example-module', name: 'Ejemplo (módulo)', catalog, detail, chapter };
}
