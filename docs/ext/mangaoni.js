const BASE = 'https://manga-oni.com';
const FILES = 'https://oni.ntr-files.online/public/archivos/mangas';
const READABLE = new Set(['manga', 'manhwa', 'manhua']);
const MAX_PAGES = 400;

const abs = (u) => {
  if (!u) return '';
  try { return new URL(u, BASE).href; } catch { return u; }
};

const typeOf = (url) => (String(url || '').match(/manga-oni\.com\/(manga|manhwa|manhua|novel|doujinshi)\//) || [])[1] || '';
const chapterIdOf = (url) => (String(url || '').match(/\/lector\/[^/]+\/(\d+)/) || [])[1] || '';
const slugOf = (url) => (String(url || '').match(/\/lector\/([^/]+)\//) || [])[1] || '';
const pageUrl = (slug, id, n) => `${FILES}/${slug}/${id}/${String(n).padStart(3, '0')}.webp`;

export default function createSource({ fetchText, parse, head }) {
  function text(el, sel) {
    return (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function mapCard(el) {
    const a = el.querySelector('a[href^="https://manga-oni.com/"], a[href^="/"]');
    const href = abs(a?.getAttribute('href'));
    if (!href || !READABLE.has(typeOf(href))) return null;
    const img = el.querySelector('img[data-src], img.cover-bg-img');
    const raw = img?.getAttribute('data-src') || img?.getAttribute('src') || '';
    return {
      url: href,
      title: (img?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim(),
      cover: raw && !raw.includes('default.gif') ? abs(raw) : '',
      type: typeOf(href),
      lastChapter: (text(el, 'span:last-of-type') || '').replace(/[^\d.]/g, '')
    };
  }

  const LISTING_BATCH_SIZE = 8;
  let lastPage = 1;
  const listingCache = new Map();
  const searchCache = new Map();

  function pageCount(doc) {
    const pages = [...doc.querySelectorAll('a[href]')].map((a) => {
      try {
        const url = new URL(a.getAttribute('href'), `${BASE}/directorio/`);
        return /^\/(?:directorio|buscar)\/?$/.test(url.pathname) ? Number(url.searchParams.get('p')) || 1 : 0;
      } catch {
        return 0;
      }
    });
    return Math.max(1, ...pages);
  }

  async function listing(p) {
    if (listingCache.has(p)) return listingCache.get(p);
    const pending = (async () => {
      const doc = parse(await fetchText(`${BASE}/directorio?filtro=nombre&orden=asc&p=${p}`));
      lastPage = Math.max(lastPage, pageCount(doc));
      return [...doc.querySelectorAll('div._135yj')]
        .map((el) => mapCard(el))
        .filter((x) => x && x.title);
    })();
    listingCache.set(p, pending);
    try {
      return await pending;
    } catch (error) {
      listingCache.delete(p);
      throw error;
    }
  }

  function mapSearchCard(el) {
    const links = [...el.querySelectorAll('a[href]')];
    const a = links.find((link) => (link.textContent || '').trim()) || links[0];
    const href = abs(a?.getAttribute('href'));
    if (!href || !READABLE.has(typeOf(href))) return null;
    const img = el.querySelector('img');
    const raw = img?.getAttribute('data-src') || img?.getAttribute('src') || '';
    const title = (a?.textContent || img?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    return {
      url: href,
      title,
      cover: raw && !raw.includes('default.gif') ? abs(raw) : '',
      type: typeOf(href),
      lastChapter: (text(el, 'span:last-of-type') || '').replace(/[^\d.]/g, '')
    };
  }

  async function search(term) {
    const key = term.trim().toLocaleLowerCase();
    if (searchCache.has(key)) return searchCache.get(key);

    const pending = (async () => {
      const searchPage = async (page) => {
        const url = `${BASE}/buscar?q=${encodeURIComponent(term)}&p=${page}`;
        const doc = parse(await fetchText(url));
        const items = [...doc.querySelectorAll('#article-div > div')]
          .map((el) => mapSearchCard(el))
          .filter((item) => item?.title);
        return { items, totalPages: pageCount(doc) };
      };

      const first = await searchPage(1);
      const found = new Map(first.items.map((item) => [item.url, item]));
      for (let start = 2; start <= first.totalPages; start += LISTING_BATCH_SIZE) {
        const count = Math.min(LISTING_BATCH_SIZE, first.totalPages - start + 1);
        const batch = await Promise.all(Array.from({ length: count }, (_, i) => searchPage(start + i)));
        for (const page of batch) {
          for (const item of page.items) found.set(item.url, item);
        }
      }
      return [...found.values()];
    })();

    searchCache.set(key, pending);
    if (searchCache.size > 20) searchCache.delete(searchCache.keys().next().value);
    try {
      return await pending;
    } catch (error) {
      searchCache.delete(key);
      throw error;
    }
  }

  async function catalog({ q = '', page = 1 } = {}) {
    if (q) return { items: await search(q), totalPages: 1, totalText: '' };

    const doc = parse(await fetchText(`${BASE}/directorio?p=${page}`));
    lastPage = Math.max(lastPage, pageCount(doc));
    const seen = new Set();
    const items = [];
    for (const el of doc.querySelectorAll('div._135yj')) {
      const item = mapCard(el);
      if (!item || !item.title || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
    return { items, totalPages: lastPage, totalText: '' };
  }

  async function detail(mangaUrl) {
    const startUrl = abs(mangaUrl);
    const doc = parse(await fetchText(startUrl));

    const title = text(doc, 'h1.post-title');

    const info = doc.querySelector('#info-i');
    const label = (re) => [...(info?.querySelectorAll('strong') || [])]
      .find((s) => re.test(s.textContent || ''));
    // El autor es texto suelto tras su strong, y el ranking va antes: se recorta
    // desde el strong hasta la siguiente etiqueta.
    const autor = (() => {
      const strong = label(/autor/i);
      if (!strong) return '';
      let node = strong.nextSibling;
      let out = '';
      while (node && node !== label(/^fecha|^estado/i)) {
        out += node.textContent || '';
        node = node.nextSibling;
      }
      return out.replace(/\s+/g, ' ').trim();
    })();

    const estado = (() => {
      const strong = label(/estado/i);
      return (strong?.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim();
    })();

    // El sitio no lista generos ni sinónimos en la ficha: no se inventan.
    const genres = [];
    const altTitles = '';

    const seen = new Set();
    const chapters = [...doc.querySelectorAll('#c_list a')]
      .map((a) => {
        const url = abs(a.getAttribute('href'));
        if (!url || seen.has(url)) return null;
        seen.add(url);
        const date = a.querySelector('span.timeago')?.getAttribute('datetime') || '';
        return { url, title: text(a, '.entry-title-h2'), date: date ? date.slice(0, 10) : '' };
      })
      .filter(Boolean);

    const bloque = doc.querySelector('#sinopsis');
    const copia = bloque?.cloneNode(true);
    copia?.querySelector('h3')?.remove();
    const sinopsis = (copia?.textContent || '').replace(/\s+/g, ' ').trim();

    return {
      title,
      cover: abs(doc.querySelector('a.portada img')?.getAttribute('src')),
      altTitles,
      genres,
      facts: {
        estado,
        status: estado,
        tipo: typeOf(startUrl),
        autor,
        vistas: ''
      },
      sinopsis,
      chapters
    };
  }

  // El lector se monta con JavaScript. Las imagenes vienen en un base64 dentro
  // del script: dir || hojas || siguiente, y no hay que deducirlas ni contarlas.
  // El nombre de cada pagina viene tal cual, con o sin ceros a la izquierda.
  async function chapter(chapterUrl) {
    const url = abs(chapterUrl);
    const doc = parse(await fetchText(url));

    let dir = '';
    const leaves = [];
    for (const s of doc.querySelectorAll('script')) {
      const m = (s.textContent || '').match(/unicap\s*=\s*["']([^"']+)["']/);
      if (!m) continue;
      try {
        const [d, raw = '[]'] = atob(m[1]).split('||');
        dir = d || '';
        for (const name of JSON.parse(raw.replace(/&quot;/g, '"'))) {
          if (name) leaves.push(name);
        }
      } catch {}
      break;
    }

    const pages = dir && leaves.length ? leaves.map((name) => dir + name) : [];

    // Sin lista en el script, se cae al endpoint que usa el propio sitio.
    if (!pages.length) {
      const slug = slugOf(url);
      const id = chapterIdOf(url);
      const pageExists = async (n) => {
        try { return !!(await head(pageUrl(slug, id, n)))?.ok; } catch { return false; }
      };
      if (await pageExists(1)) {
        let low = 1;
        let high = 2;
        while (high < MAX_PAGES && await pageExists(high)) {
          low = high;
          high = Math.min(high * 2, MAX_PAGES);
        }
        if (high === MAX_PAGES && await pageExists(high)) {
          low = high;
        } else {
          while (high - low > 1) {
            const middle = Math.floor((low + high) / 2);
            if (await pageExists(middle)) low = middle;
            else high = middle;
          }
        }
        for (let n = 1; n <= low; n++) pages.push(pageUrl(slug, id, n));
      }
    }

    // El sitio no manda la lista de capitulos en el HTML: se trae de la ficha
    // cuando el slug y el id la identifican sin ambiguedad.
    let options = [];
    const mangaUrl = abs(doc.querySelector('a.ajp')?.getAttribute('href')) || '';
    if (mangaUrl) {
      const ficha = parse(await fetchText(mangaUrl));
      const id = chapterIdOf(url);
      const opts = [...ficha.querySelectorAll('#c_list a')]
        .map((a) => ({ url: abs(a.getAttribute('href')), title: text(a, '.entry-title-h2') }))
        .filter((o) => o.url && o.title);
      // La ficha ya viene en orden inverso (cap 155 primero). Cytlex invierte
      // options al mostrarla, asi que se entrega tal cual y en pantalla queda
      // del capitulo 1 en adelante. En esta lista el anterior va por delante.
      options = opts;
      const idx = options.findIndex((o) => chapterIdOf(o.url) === id);
      return {
        label: options[idx]?.title || '',
        mangaUrl,
        pages,
        options,
        prev: idx >= 0 && options[idx + 1] ? { title: options[idx + 1].title, url: options[idx + 1].url } : null,
        next: idx >= 0 && options[idx - 1] ? { title: options[idx - 1].title, url: options[idx - 1].url } : null
      };
    }

    return { label: '', mangaUrl, pages, options, prev: null, next: null };
  }

  return { id: 'mangaoni', name: 'MangaOni', catalog, detail, chapter };
}
