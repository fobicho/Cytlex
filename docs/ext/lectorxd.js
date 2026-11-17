export default function createSource({ fetchText, parse }) {
  const base = 'https://lectorxd.com';
  const chapterCache = new Map();
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const decode = (value) => {
    try { return decodeURIComponent(value); } catch { return value; }
  };
  const abs = (value, context = base) => {
    if (!value || String(value).startsWith('data:')) return '';
    try { return new URL(value, context).href; } catch { return ''; }
  };

  function document(html) {
    if (/Just a moment\.\.\.|cf-chl-/i.test(String(html || ''))) {
      throw new Error('LectorXD mostró una verificación de Cloudflare.');
    }
    return parse(html);
  }

  function requestError(error, resource) {
    const message = String(error?.message || error || '');
    if (!/\bHTTP 403\b/.test(message)) return error;
    return Object.assign(new Error(`LectorXD respondió con una verificación de Cloudflare (HTTP 403) al solicitar ${resource}.`), {
      status: error?.status || 403,
      requestOrigin: error?.requestOrigin || 'source',
      reason: 'cloudflare'
    });
  }

  function imageUrl(image, context) {
    for (const attribute of ['data-src', 'data-lazy-src', 'data-original', 'src']) {
      const url = abs(image?.getAttribute(attribute), context);
      if (url) return url;
    }
    return '';
  }

  function nextPage(doc) {
    return Boolean(doc.querySelector('a[aria-label="Next page"][href*="page="]'));
  }

  async function catalog({ q = '', page = 1, __cytlexRequestId } = {}) {
    const currentPage = Math.max(1, Number(page) || 1);
    const url = new URL('/catalogo', base);
    url.searchParams.set('adult', 'all');
    url.searchParams.set('filters', 'true');
    url.searchParams.set('orderBy', 'recent');
    if (currentPage > 1) url.searchParams.set('page', String(currentPage));
    if (clean(q)) url.searchParams.set('search', clean(q));

    let html;
    try {
      html = await fetchText(url.href, __cytlexRequestId);
    } catch (error) {
      throw requestError(error, 'el catálogo');
    }
    const doc = document(html);
    const items = [...doc.querySelectorAll('.manga-grid a[href]')]
      .filter((card) => !new URL(card.getAttribute('href'), base).pathname.startsWith('/novela/'))
      .map((card) => {
        const url = abs(card.getAttribute('href'));
        const title = clean(card.querySelector('h4')?.textContent);
        const type = new URL(url).pathname.split('/').filter(Boolean)[0] || '';
        const lastChapter = clean(card.querySelector('.material-icons-outlined')?.parentElement?.textContent)
          .replace(/^menu_book\s*/i, '');
        return {
          url,
          title,
          cover: imageUrl(card.querySelector('img'), url),
          type: type.replace(/^./, (character) => character.toUpperCase()),
          lastChapter
        };
      })
      .filter((item) => item.url && item.title)
      .filter((item, index, list) => list.findIndex((candidate) => candidate.url === item.url) === index);

    return { items, totalPages: currentPage + Number(nextPage(doc)) };
  }

  function unwrapAstro(value) {
    if (Array.isArray(value)) {
      if (value.length === 2 && Number.isInteger(value[0])) return unwrapAstro(value[1]);
      return value.map(unwrapAstro);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unwrapAstro(item)]));
    }
    return value;
  }

  function parseChapterProps(doc) {
    const island = doc.querySelector('astro-island[component-url*="ChapterList"]');
    const raw = island?.getAttribute('props');
    if (!raw) throw new Error('LectorXD no entregó la lista de capítulos.');
    try {
      return unwrapAstro(JSON.parse(raw));
    } catch {
      throw new Error('LectorXD devolvió una lista de capítulos no válida.');
    }
  }

  function chapterUrl(type, slug, chapter) {
    const url = new URL(`/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/leer/${encodeURIComponent(chapter.chapter)}`, base);
    if (chapter.groupId != null) url.searchParams.set('g', String(chapter.groupId));
    return url.href;
  }

  function chapterEntries(props, type, slug) {
    const chapters = (Array.isArray(props.chapters) ? props.chapters : [])
      .filter((chapter) => chapter && chapter.chapter != null && clean(chapter.chapter))
      .map((chapter) => ({
        value: chapter,
        number: clean(chapter.chapter),
        url: chapterUrl(type, slug, chapter)
      }))
      .sort((a, b) => a.number.localeCompare(b.number, 'es', { numeric: true }));

    return chapters
      .filter((chapter, index, list) => list.findIndex((candidate) => candidate.url === chapter.url) === index)
      .map(({ value, number, url }) => ({
        title: `Capítulo ${number}`,
        url,
        date: clean(value.publishAt),
        group: value.groupId == null ? '' : String(value.groupId)
      }));
  }

  function rememberChapters(mangaUrl, chapters) {
    chapterCache.delete(mangaUrl);
    chapterCache.set(mangaUrl, chapters);
    while (chapterCache.size > 40) chapterCache.delete(chapterCache.keys().next().value);
  }

  function mangaTypeLabel(type) {
    return clean(type).replace(/(^|[-\s])\w/g, (value) => value.toUpperCase()) || 'Manga';
  }

  async function detail(mangaUrl, requestId) {
    const url = abs(mangaUrl);
    if (!url) throw new Error('No se pudo identificar el manga de LectorXD.');
    let html;
    try {
      html = await fetchText(url, requestId);
    } catch (error) {
      throw requestError(error, 'la ficha y sus capítulos');
    }
    const doc = document(html);
    const route = new URL(url).pathname.split('/').filter(Boolean).map(decode);
    const props = parseChapterProps(doc);
    const type = clean(props.mangaType || route[0]);
    const slug = clean(props.mangaSlug || route[1]);
    if (!type || !slug) throw new Error('LectorXD no identificó el manga de la ficha.');

    const chapters = chapterEntries(props, type, slug);
    if (!chapters.length) throw new Error('LectorXD no entregó capítulos para este manga.');
    rememberChapters(url, chapters);

    const alternativeTitlesLabel = [...doc.querySelectorAll('span')]
      .find((element) => clean(element.textContent).toLocaleLowerCase('es') === 'títulos alternativos');
    const alternativeTitles = clean(alternativeTitlesLabel?.nextElementSibling?.textContent);
    const title = clean(doc.querySelector('h1')?.textContent);
    const synopsis = clean(doc.querySelector('p.leading-relaxed')?.textContent);
    const genres = [...doc.querySelectorAll('a[href^="/catalogo?tags="]')]
      .map((element) => clean(element.textContent))
      .filter(Boolean);
    const cover = imageUrl(doc.querySelector("img.object-contain[src*='/manga/covers/']"), url);
    const statusText = clean(doc.querySelector('h1')?.parentElement?.parentElement?.textContent);
    const status = /completado/i.test(statusText) ? 'Finalizado'
      : /en emisi[oó]n/i.test(statusText) ? 'En curso' : '';

    return {
      title,
      cover,
      altTitles: alternativeTitles,
      genres,
      facts: {
        estado: status,
        status,
        tipo: mangaTypeLabel(type),
        capítulos: String(chapters.length)
      },
      sinopsis: synopsis,
      chapters
    };
  }

  async function chapter(chapterUrl) {
    const url = new URL(chapterUrl, base);
    const parts = url.pathname.split('/').filter(Boolean).map(decode);
    const [type, slug, , number] = parts;
    if (!type || !slug || !number) throw new Error('No se pudo identificar el capítulo de LectorXD.');

    const mangaUrl = new URL(`/${encodeURIComponent(type)}/${encodeURIComponent(slug)}`, base).href;
    let html;
    try {
      html = await fetchText(url.href, undefined, { headers: { Referer: mangaUrl } });
    } catch (error) {
      if (/\bHTTP 403\b/.test(String(error?.message || error))) {
        throw new Error('LectorXD rechazó el capítulo (HTTP 403).');
      }
      throw error;
    }
    const doc = document(html);
    const pages = [...doc.querySelectorAll('img.page-image')]
      .map((image) => imageUrl(image, url.href))
      .filter((page, index, list) => page && list.indexOf(page) === index);
    if (!pages.length) throw new Error('LectorXD no entregó páginas legibles para este capítulo.');

    const options = chapterCache.get(mangaUrl) || [];
    const currentUrl = url.href;
    const index = options.findIndex((item) => item.url === currentUrl);
    return {
      label: options[index]?.title || `Capítulo ${number}`,
      mangaUrl,
      imageReferer: url.href,
      pages,
      options,
      prev: index > 0 ? options[index - 1] : null,
      next: index >= 0 && index + 1 < options.length ? options[index + 1] : null
    };
  }

  return { id: 'lectorxd', name: 'LectorXD', catalog, detail, chapter };
}
