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
          author: text(el, '.manga-author, .card-author, .author'),
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
      .map((c) => {
        const num = c.numero != null && c.numero !== '' ? String(parseFloat(c.numero)) : '';
        const group = c.grupo_cap_nombres
          || (c.grupos_list || []).map((g) => g.nombre).filter(Boolean).join(', ')
          || '';
        return {
          url: abs(c.url),
          title: num ? `Capítulo ${num}` : (c.titulo || c.titulo_str || ''),
          group,
          date: c.fecha_str || c.fecha_subida || ''
        };
      })
      .filter((x) => x.url);
  }

  async function catalog({ q = '', __cytlexRequestId } = {}) {
    const url = q ? `${base}/buscar.php?q=${encodeURIComponent(q)}` : `${base}/`;
    const doc = parse(await fetchText(url, __cytlexRequestId));
    return { items: mapCards(doc), totalPages: 1, totalText: '' };
  }

  async function detail(mangaUrl) {
    const html = await fetchText(abs(mangaUrl));
    const doc = parse(html);
    const coverImg = doc.querySelector('img.manga-poster');
    const desc = doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

    const genres = [...doc.querySelectorAll('.genre-tag')].map((e) => e.textContent.trim()).filter(Boolean);
    return {
      title: text(doc, 'h1.manga-title'),
      cover: abs(coverImg?.getAttribute('src')),
      altTitles: '',
      genres,
      facts: { estado: '', status: '', tipo: '', autor: '', vistas: '' },
      sinopsis: desc.trim(),
      chapters: decodeChapters(html)
    };
  }

  async function chapter(chapterUrl) {
    const url = abs(chapterUrl);
    const html = await fetchText(url);
    const outer = parse(html);
    const resolvePageUrl = (pageUrl) => {
      if (!pageUrl) return '';
      try { return new URL(pageUrl, url).href; } catch { return ''; }
    };
    let pageList;
    const encodedPages = outer.querySelector('#viewerContainer')?.getAttribute('data-reader-pages');
    if (encodedPages) {
      try {
        const bytes = Uint8Array.from(atob(encodedPages), (char) => char.charCodeAt(0));
        pageList = JSON.parse(new TextDecoder().decode(bytes));
      } catch {}
    }
    if (!Array.isArray(pageList)) {
      const hexPages = html.match(/(?:const|let|var)\s+_hexP\s*=\s*["']([0-9a-fA-F]+)["']/);
      if (hexPages) {
        try {
          const bytes = Uint8Array.from(hexPages[1].match(/.{2}/g) || [], (byte) => parseInt(byte, 16));
          pageList = JSON.parse(new TextDecoder().decode(bytes));
        } catch {}
      }
    }
    const pages = Array.isArray(pageList)
      ? pageList.map((page) => {
          if (typeof page === 'string') return page;
          if (!page || typeof page !== 'object') return '';
          return page.url || page.src || page.image || page.srcUrl || page.pageUrl || '';
        }).map(resolvePageUrl).filter(Boolean)
      : [...parse(html.match(/<noscript[^>]*>([\s\S]*?)<\/noscript>/i)?.[1] || html).querySelectorAll('img.manga-page')]
          .map((el) => resolvePageUrl(el.getAttribute('src') || el.getAttribute('data-src')))
          .filter(Boolean);
    return {
      label: text(outer, 'h1') || '',
      mangaUrl: '',
      imageReferer: url,
      pages: [...new Set(pages)],
      options: [],
      prev: null,
      next: null
    };
  }

  return { id: 'onfmangas', name: 'ONF Mangas', catalog, detail, chapter };
}
